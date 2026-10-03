-- Unify vector search across sync ingest (`chunks`) and async page-split
-- pipeline (`document_chunks`). Adds document-scoped search for Q&A.
--
-- DROP first: prior overloads returned document_id uuid; this migration
-- widens to text. Postgres rejects CREATE OR REPLACE when OUT row types change
-- (SQLSTATE 42P13).

DROP FUNCTION IF EXISTS public.match_chunks(vector, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.match_chunks(vector, uuid, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  match_count integer DEFAULT 5
)
RETURNS TABLE(content text, document_id text, page_number integer, similarity double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    u.content,
    u.document_id,
    u.page_number,
    1 - (u.embedding <=> query_embedding) AS similarity
  FROM (
    SELECT c.content, c.document_id, c.page_number, c.embedding
    FROM chunks c
    WHERE c.tenant_id = match_tenant_id
      AND c.project_id = match_project_id
      AND c.embedding IS NOT NULL
    UNION ALL
    SELECT dc.content, dc.document_id, dc.page_number, dc.embedding
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id AND d.tenant_id = dc.tenant_id
    WHERE dc.tenant_id = match_tenant_id
      AND d.project_id = match_project_id
      AND dc.embedding IS NOT NULL
  ) u
  ORDER BY u.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  query_text text DEFAULT ''::text,
  match_count integer DEFAULT 6,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(content text, document_id text, page_number integer, similarity double precision, rrf_score double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH unified AS (
      SELECT c.id, c.content, c.document_id, c.page_number, c.embedding, c.fts
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.embedding IS NOT NULL
      UNION ALL
      SELECT
        dc.id,
        dc.content,
        dc.document_id,
        dc.page_number,
        dc.embedding,
        to_tsvector('english', COALESCE(dc.content, '')) AS fts
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id AND d.tenant_id = dc.tenant_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
    ),
    vector_ranked AS (
      SELECT
        u.id,
        u.content,
        u.document_id,
        u.page_number,
        1 - (u.embedding <=> query_embedding) AS sim,
        ROW_NUMBER() OVER (ORDER BY u.embedding <=> query_embedding) AS vec_rank
      FROM unified u
      ORDER BY u.embedding <=> query_embedding
      LIMIT match_count * 4
    ),
    keyword_ranked AS (
      SELECT
        u.id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(u.fts, websearch_to_tsquery('english', query_text)) DESC
        ) AS kw_rank
      FROM unified u
      WHERE u.fts @@ websearch_to_tsquery('english', query_text)
      LIMIT match_count * 4
    )
    SELECT
      vr.content,
      vr.document_id,
      vr.page_number,
      vr.sim AS similarity,
      (
        COALESCE(1.0 / (rrf_k + vr.vec_rank), 0) +
        COALESCE(1.0 / (rrf_k + kr.kw_rank), 0)
      ) AS rrf_score
    FROM vector_ranked vr
    LEFT JOIN keyword_ranked kr ON kr.id = vr.id
    ORDER BY rrf_score DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    SELECT
      mc.content,
      mc.document_id,
      mc.page_number,
      mc.similarity,
      1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY mc.similarity DESC)) AS rrf_score
    FROM public.match_chunks(query_embedding, match_tenant_id, match_project_id, match_count) mc;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_document_id text,
  match_count integer DEFAULT 8
)
RETURNS TABLE(content text, page_number integer, similarity double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    u.content,
    u.page_number,
    1 - (u.embedding <=> query_embedding) AS similarity
  FROM (
    SELECT c.content, c.page_number, c.embedding
    FROM chunks c
    WHERE c.tenant_id = match_tenant_id
      AND c.document_id = match_document_id
      AND c.embedding IS NOT NULL
    UNION ALL
    SELECT dc.content, dc.page_number, dc.embedding
    FROM document_chunks dc
    WHERE dc.tenant_id = match_tenant_id
      AND dc.document_id = match_document_id
      AND dc.embedding IS NOT NULL
  ) u
  ORDER BY u.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_document_chunks(vector, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, text, integer) TO service_role;

ALTER FUNCTION public.match_chunks(vector, uuid, uuid, integer) SET search_path = public;
ALTER FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer) SET search_path = public;
ALTER FUNCTION public.match_document_chunks(vector, uuid, text, integer) SET search_path = public;
