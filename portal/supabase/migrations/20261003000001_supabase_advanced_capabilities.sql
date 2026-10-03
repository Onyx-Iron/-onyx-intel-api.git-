-- Supabase advanced capabilities:
--   A. (app-side) Realtime broadcast/presence for multi-estimator canvas collab
--   B. HNSW + FTS on document_chunks + hybrid RRF search across chunks sources
--   C. Nightly commodity sync via pg_cron + pg_net (outbox minutely already live)
--
-- Vault secrets (one-time, not committed):
--   service_role_key          — edge function Authorization bearer
--   internal_worker_secret    — outbox worker x-worker-secret header

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── B. document_chunks: generated FTS + HNSW ────────────────────────────────
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED;

CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
  ON public.document_chunks USING gin (fts);

-- HNSW for cosine ANN (replaces any legacy IVFFlat on this table if present)
DROP INDEX IF EXISTS document_chunks_embedding_ivfflat;
DROP INDEX IF EXISTS document_chunks_embedding_idx;

CREATE INDEX IF NOT EXISTS document_chunks_hnsw
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Dedicated hybrid RPC for page-split pipeline chunks (join documents for project)
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
SET search_path TO 'public'
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
        1 - (dc.embedding <=> query_embedding) AS sim,
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
      dc.content,
      dc.document_id,
      dc.page_number,
      1 - (dc.embedding <=> query_embedding) AS similarity,
      1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding)) AS rrf_score
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

REVOKE ALL ON FUNCTION public.match_document_chunks(vector, uuid, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, uuid, text, integer, integer) TO service_role;

-- Expand hybrid match_chunks to RRF across both `chunks` and `document_chunks`
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
SET search_path TO 'public'
AS $function$
DECLARE
  use_hybrid boolean := query_text IS NOT NULL AND length(trim(query_text)) > 0;
BEGIN
  IF use_hybrid THEN
    RETURN QUERY
    WITH corpus AS (
      SELECT
        c.id,
        c.content,
        c.document_id,
        c.page_number,
        c.embedding,
        c.fts,
        'chunks'::text AS src
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
        dc.fts,
        'document_chunks'::text AS src
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc.document_id
      WHERE dc.tenant_id = match_tenant_id
        AND d.project_id = match_project_id
        AND dc.embedding IS NOT NULL
    ),
    vector_ranked AS (
      SELECT
        corpus.id,
        corpus.src,
        corpus.content,
        corpus.document_id,
        corpus.page_number,
        1 - (corpus.embedding <=> query_embedding) AS sim,
        ROW_NUMBER() OVER (ORDER BY corpus.embedding <=> query_embedding) AS vec_rank
      FROM corpus
      ORDER BY corpus.embedding <=> query_embedding
      LIMIT match_count * 4
    ),
    keyword_ranked AS (
      SELECT
        corpus.id,
        corpus.src,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(corpus.fts, websearch_to_tsquery('english', query_text)) DESC
        ) AS kw_rank
      FROM corpus
      WHERE corpus.fts @@ websearch_to_tsquery('english', query_text)
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
    LEFT JOIN keyword_ranked kr ON kr.id = vr.id AND kr.src = vr.src
    ORDER BY rrf_score DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    WITH corpus AS (
      SELECT
        c.content,
        c.document_id,
        c.page_number,
        c.embedding
      FROM chunks c
      WHERE c.tenant_id = match_tenant_id
        AND c.project_id = match_project_id
        AND c.embedding IS NOT NULL
      UNION ALL
      SELECT
        dc.content,
        dc.document_id,
        dc.page_number,
        dc.embedding
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
      1 - (corpus.embedding <=> query_embedding) AS similarity,
      1.0 / (rrf_k + ROW_NUMBER() OVER (ORDER BY corpus.embedding <=> query_embedding)) AS rrf_score
    FROM corpus
    ORDER BY corpus.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$function$;

ALTER FUNCTION public.match_chunks(vector, uuid, uuid, text, integer, integer) SET search_path = public;

-- ── C. Nightly commodity sync at 02:00 UTC (replace monthly schedule) ───────
DO $$
BEGIN
  PERFORM cron.unschedule('sync-commodity-indexes-monthly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-commodity-indexes-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-commodity-indexes-nightly',
  '0 2 * * *', -- 02:00 UTC every day
  $$
  SELECT net.http_post(
    url := 'https://vvnigrbdsipriufhrwbs.supabase.co/functions/v1/sync-commodity-indexes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Outbox minutely job is already scheduled by 20261002000001; re-assert it.
DO $$
BEGIN
  PERFORM cron.unschedule('estimate-sync-outbox-minutely');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'estimate-sync-outbox-minutely',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.onyx-iron.com/api/internal/outbox/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_worker_secret'
      )
    ),
    body := '{"batch_size":20}'::jsonb
  ) AS request_id;
  $$
);
