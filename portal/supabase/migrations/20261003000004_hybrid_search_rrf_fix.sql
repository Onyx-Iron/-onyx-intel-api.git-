-- Fix hybrid RRF so keyword-only hits are not dropped, and FTS does not
-- require embeddings. Rebuild match_chunks / match_document_chunks.

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector,
  match_tenant_id uuid,
  match_project_id uuid,
  query_text text DEFAULT ''::text,
  match_count integer DEFAULT 6,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  content text,
  document_id text,
  page_number integer,
  similarity double precision,
  rrf_score double precision
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH vector_ranked AS (
      SELECT
        dc.id,
        dc.content,
        dc.document_id,
        dc.page_number,
        (1 - (dc.embedding <=> query_embedding))::double precision AS sim,
        ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS vec_rank
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> query_embedding
      LIMIT match_count * 4
    ),
    keyword_ranked AS (
      SELECT
        dc.id,
        dc.content,
        dc.document_id,
        dc.page_number,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC
        ) AS kw_rank
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.fts @@ websearch_to_tsquery('english', query_text)
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
    FULL OUTER JOIN keyword_ranked kr ON kr.id = vr.id
    ORDER BY rrf_score DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    SELECT
      dc.content,
      dc.document_id,
      dc.page_number,
      (1 - (dc.embedding <=> query_embedding))::double precision AS similarity,
      (1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding)))::double precision AS rrf_score
    FROM document_chunks dc
    INNER JOIN documents d ON d.id = dc.document_id
    WHERE dc.tenant_id = match_tenant_id
      AND d.project_id = match_project_id
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
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
RETURNS TABLE(
  content text,
  document_id text,
  page_number integer,
  similarity double precision,
  rrf_score double precision
)
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
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.embedding IS NOT NULL
      UNION ALL
      SELECT dc.id, dc.content, dc.document_id, dc.page_number, dc.embedding, 'document_chunks'::text AS src
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
    ),
    keyword_corpus AS (
      SELECT c.id, c.content, c.document_id, c.page_number, c.fts, 'chunks'::text AS src
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
      UNION ALL
      SELECT dc.id, dc.content, dc.document_id, dc.page_number, dc.fts, 'document_chunks'::text AS src
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
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
    WITH corpus AS (
      SELECT c.content, c.document_id, c.page_number, c.embedding
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.embedding IS NOT NULL
      UNION ALL
      SELECT dc.content, dc.document_id, dc.page_number, dc.embedding
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
    )
    SELECT
      corpus.content,
      corpus.document_id,
      corpus.page_number,
      (1 - (corpus.embedding <=> query_embedding))::double precision AS similarity,
      (1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY corpus.embedding <=> query_embedding)))::double precision AS rrf_score
    FROM corpus
    ORDER BY corpus.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$function$;

-- Point outbox cron at Authorization: Bearer cron_secret (matches route auth),
-- and commodity sync at service_role_key — both vault names documented below.
-- One-time (do not commit values):
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'service_role_key');

DO $$
BEGIN
  PERFORM cron.unschedule('estimate-sync-outbox-minutely');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'estimate-sync-outbox-minutely',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://app.onyx-iron.com/api/internal/outbox/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{"batch_size":20}'::jsonb
  ) AS request_id
  FROM (
    SELECT decrypted_secret AS secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
      AND decrypted_secret IS NOT NULL
      AND length(trim(decrypted_secret)) > 0
    LIMIT 1
  ) vault_secret;
  -- No row → no HTTP call. Avoids Clerk HTML 307/200 spam when Vault is empty.
  $cron$
);

DO $$
BEGIN
  PERFORM cron.unschedule('sync-commodity-indexes-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-commodity-indexes-nightly',
  '0 2 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://vvnigrbdsipriufhrwbs.supabase.co/functions/v1/sync-commodity-indexes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb
  ) AS request_id
  FROM (
    SELECT decrypted_secret AS secret
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
      AND decrypted_secret IS NOT NULL
      AND length(trim(decrypted_secret)) > 0
    LIMIT 1
  ) vault_secret;
  $cron$
);
