-- Page-split ingestion pipeline
-- Adds per-page tracking + chunk-to-page mapping for grounded RAG.

-- 1. page_count + processing status on documents ------------------------------
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_file_id text;

-- 2. One row per page of a split PDF ------------------------------------------
CREATE TABLE IF NOT EXISTS document_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- documents.id is text (not uuid, unlike every other table's PK) --
  -- verified against production; corrected here after branch-replay found
  -- the mismatch (see docs/frontend-backend-reconciliation/MIGRATION_DRIFT_SWEEP.md).
  document_id   text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number   integer NOT NULL,
  storage_path  text NOT NULL,        -- plans-bucket/pages/{document_id}/page-{n}.pdf
  status        text NOT NULL DEFAULT 'pending',  -- pending | processing | done | error
  error         text,
  ocr_text      text,                 -- raw text extracted from the page (may be NULL for images)
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_document_pages_document
  ON document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_document_pages_tenant_status
  ON document_pages(tenant_id, status);

-- 3. Vector chunks, now grounded to a specific page ---------------------------
CREATE TABLE IF NOT EXISTS document_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- documents.id is text -- see note on document_pages.document_id above.
  document_id   text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id       uuid REFERENCES document_pages(id) ON DELETE CASCADE,
  page_number   integer,
  chunk_index   integer NOT NULL,
  content       text NOT NULL,
  embedding     vector(768),           -- text-embedding-004 dim
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document
  ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_page
  ON document_chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant
  ON document_chunks(tenant_id);
