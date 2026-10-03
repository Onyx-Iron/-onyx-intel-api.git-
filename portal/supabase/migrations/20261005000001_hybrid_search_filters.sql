-- Optional document / doc_type filters for hybrid match_chunks (RRF).

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  query_text text DEFAULT ''::text,
  match_count integer DEFAULT 6,
  rrf_k integer DEFAULT 60,
  filter_document_ids text[] DEFAULT NULL,
  filter_doc_types text[] DEFAULT NULL
)
RETURNS TABLE(content text, document_id text, page_number integer, similarity double precision, rrf_score double precision)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH vector_corpus AS (
      SELECT c.id, c.content, c.document_id, c.page_number, c.embedding, 'chunks'::text AS src
      FROM chunks c
      LEFT JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.embedding IS NOT NULL
        AND (filter_document_ids IS NULL OR c.document_id = ANY (filter_document_ids))
        AND (filter_doc_types IS NULL OR d.doc_type = ANY (filter_doc_types))
      UNION ALL
      SELECT dc.id, dc.content, dc.document_id, dc.page_number, dc.embedding, 'document_chunks'::text AS src
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id AND d.tenant_id = dc.tenant_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
        AND (filter_document_ids IS NULL OR dc.document_id = ANY (filter_document_ids))
        AND (filter_doc_types IS NULL OR d.doc_type = ANY (filter_doc_types))
    ),
    keyword_corpus AS (
      SELECT c.id, c.content, c.document_id, c.page_number, c.fts, 'chunks'::text AS src
      FROM chunks c
      LEFT JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND (filter_document_ids IS NULL OR c.document_id = ANY (filter_document_ids))
        AND (filter_doc_types IS NULL OR d.doc_type = ANY (filter_doc_types))
      UNION ALL
      SELECT
        dc.id,
        dc.content,
        dc.document_id,
        dc.page_number,
        COALESCE(dc.fts, to_tsvector('english', COALESCE(dc.content, ''))) AS fts,
        'document_chunks'::text AS src
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id AND d.tenant_id = dc.tenant_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND (filter_document_ids IS NULL OR dc.document_id = ANY (filter_document_ids))
        AND (filter_doc_types IS NULL OR d.doc_type = ANY (filter_doc_types))
    ),
    vector_ranked AS (
      SELECT
        vector_corpus.id,
        vector_corpus.src,
        vector_corpus.content,
        vector_corpus.document_id,
        vector_corpus.page_number,
        (1 - (vector_corpus.embedding <=> query_embedding))::double precision AS sim,
        ROW_NUMBER() OVER (ORDER BY vector_corpus.embedding <=> query_embedding) AS vec_rank
      FROM vector_corpus
      ORDER BY vector_corpus.embedding <=> query_embedding
      LIMIT match_count * 4
    ),
    keyword_ranked AS (
      SELECT
        ranked.id,
        ranked.src,
        ranked.content,
        ranked.document_id,
        ranked.page_number,
        ranked.kw_rank
      FROM (
        SELECT
          keyword_corpus.id,
          keyword_corpus.src,
          keyword_corpus.content,
          keyword_corpus.document_id,
          keyword_corpus.page_number,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(keyword_corpus.fts, websearch_to_tsquery('english', query_text)) DESC
          ) AS kw_rank
        FROM keyword_corpus
        WHERE keyword_corpus.fts @@ websearch_to_tsquery('english', query_text)
      ) ranked
      ORDER BY ranked.kw_rank
      LIMIT match_count * 4
    )
    SELECT
      COALESCE(vr.content, kr.content) AS content,
      COALESCE(vr.document_id, kr.document_id) AS document_id,
      COALESCE(vr.page_number, kr.page_number) AS page_number,
      COALESCE(vr.sim, 0)::double precision AS similarity,
      (
        COALESCE(1.0 / (rrf_k + vr.vec_rank), 0) +
        COALESCE(1.0 / (rrf_k + kr.kw_rank), 0)
      )::double precision AS rrf_score
    FROM vector_ranked vr
    FULL OUTER JOIN keyword_ranked kr ON kr.id = vr.id AND kr.src = vr.src
    ORDER BY rrf_score DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    SELECT
      mc.content,
      mc.document_id,
      mc.page_number,
      mc.similarity,
      (1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY mc.similarity DESC)))::double precision AS rrf_score
    FROM public.match_chunks(query_embedding, match_tenant_id, match_project_id, match_count) mc
    WHERE (filter_document_ids IS NULL OR mc.document_id = ANY (filter_document_ids));
  END IF;
END;
$function$;

ALTER FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer, text[], text[])
  SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer, text[], text[]) TO service_role;
