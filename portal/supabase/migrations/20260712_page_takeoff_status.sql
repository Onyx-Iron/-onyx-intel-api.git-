-- page-processor (OCR/embeddings) and page-takeoff-worker (CSI takeoff rows)
-- both run per page-split page independently. They must NOT share
-- `document_pages.status` — two independent workers writing the same column
-- race each other and corrupt whichever one finishes last, so takeoff
-- progress tracking gets its own column.
ALTER TABLE public.document_pages ADD COLUMN IF NOT EXISTS takeoff_status text DEFAULT 'pending';
ALTER TABLE public.document_pages ADD COLUMN IF NOT EXISTS takeoff_error   text;
