# Onyx Intel — Supabase Edge Functions

Three functions power the Drive / local upload → page-split → OCR + takeoff pipeline:

| Function               | Trigger                                            | Purpose                                                        |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `page-split-worker`    | Portal `queuePageSplit` / import-drive / from-document | Stream Drive or read Storage → pdf-lib split → insert `document_pages` → fan-out |
| `page-processor`       | Fan-out from `page-split-worker` (one per page)    | Density → Docling (text) or Gemini (drawings) → chunk/embed + `meta` |
| `page-takeoff-worker`  | Fan-out from `page-split-worker` (one per page)    | CSI takeoff extraction per page → estimate rows                |

## Prerequisites

1. **Storage bucket `plans-bucket`** must exist. Create it in the Supabase
   dashboard (Storage → New bucket) with **private** access, **500 MB** file
   size limit.
2. **Vector extension** — already enabled by the `page_split_pipeline`
   migration.
3. **Env vars** — set on each function via `supabase secrets set`:

   ```bash
   supabase secrets set \
     GEMINI_API_KEY="AQ...your-billing-key" \
     PLANS_BUCKET="plans-bucket" \
     GEMINI_TEXT_MODEL="gemini-2.5-pro" \
     GEMINI_EMBED_MODEL="text-embedding-004" \
     PYTHON_API_URL="https://your-railway.example.com" \
     ONYX_API_SECRET="shared-with-railway" \
     ENABLE_DOCLING="1"
   ```

   Optional: `DOCLING_MIN_CHARS` (default `400`) — pdfplumber char threshold
   before trying Docling. Railway must also have `ENABLE_DOCLING=1` and
   `requirements-docling.txt` installed; otherwise page-processor falls back
   to Gemini automatically.

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
   Edge Function runtime — do NOT set them manually.

## Deploy

From the `portal/` directory:

```bash
# One-time: link the local project to the Supabase project
supabase link --project-ref vvnigrbdsipriufhrwbs

# Deploy all page-pipeline functions
supabase functions deploy page-split-worker
supabase functions deploy page-processor
supabase functions deploy page-takeoff-worker
```

## Verify

1. Import a Drive file via the portal:
   ```
   POST /api/documents/import-drive
   { "project_id": "...", "file_id": "1AbCd..." }
   ```
   → returns `202 { document_id, status: "queued" }`

2. Watch progress:
   ```sql
   SELECT id, file_name, status, page_count FROM documents ORDER BY uploaded_at DESC LIMIT 5;
   SELECT page_number, status, error FROM document_pages WHERE document_id = '...' ORDER BY page_number;
   SELECT count(*) FROM document_chunks WHERE document_id = '...';
   ```

3. If a page errors, `document_pages.error` has the reason. Re-trigger by
   invoking the function directly:
   ```bash
   curl -X POST "$SUPABASE_URL/functions/v1/page-processor" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"page_id":"...","document_id":"...","tenant_id":"...","page_number":1,"storage_path":"pages/.../page-1.pdf"}'
   ```

## Design notes

- **Durable fan-out.** `page-split-worker` enqueues each page to
  `page-processor` and `page-takeoff-worker`, then uses Edge `waitUntil`
  so cold isolates don't drop kicks when the HTTP response returns.
- **No `display_name`.** Payloads to Gemini's `generateContent` REST
  endpoint deliberately omit `display_name` — it exists only in the Files
  API and the inlineData shape rejects it.
- **Idempotent rekick.** Re-invoking `page-split-worker` clears prior
  `document_pages` for the document, then re-inserts — safe for Retry /
  partial (`complete_with_errors`) recovery.
- **Grounded chunks.** Every `document_chunks` row carries `page_id` +
  `page_number` so the AI chat's RAG retriever can cite "page 42 of the
  arch set" instead of "somewhere in that PDF".
- **OCR finalize.** Portal `GET /api/documents` rolls settled page OCR
  into `documents.status` (`complete` / `complete_with_errors` / `error`)
  so the Documents UI does not spin forever on `split`.
