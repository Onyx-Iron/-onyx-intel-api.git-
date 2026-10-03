# Onyx Intel — Supabase Edge Functions

Two functions power the Drive → page-split → per-page RAG pipeline:

| Function             | Trigger                                            | Purpose                                                        |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `page-split-worker`  | `POST /api/documents/import-drive` (portal)        | Stream Drive → Storage → pdf-lib split → insert `document_pages` |
| `page-processor`     | Fan-out from `page-split-worker` (one per page)    | gpt-4.1 (or Gemini) extract → chunk → 768-d embed → `document_chunks` |

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
     GEMINI_EMBED_MODEL="gemini-embedding-2" \
     OPENAI_API_KEY="sk-...optional, preferred for sheet reading"
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
   Edge Function runtime — do NOT set them manually.

## Deploy

From the `portal/` directory:

```bash
# One-time: link the local project to the Supabase project
supabase link --project-ref vvnigrbdsipriufhrwbs

# Deploy both functions
supabase functions deploy page-split-worker
supabase functions deploy page-processor
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

- **Fire-and-forget fan-out.** `page-split-worker` fires each page to
  `page-processor` with `Promise.allSettled` — one failing page doesn't
  block the others.
- **No `display_name`.** Payloads to Gemini's `generateContent` REST
  endpoint deliberately omit `display_name` — it exists only in the Files
  API and the inlineData shape rejects it.
- **Idempotent.** Re-invoking `page-split-worker` on the same `document_id`
  upserts the original PDF and re-inserts pages (blocked by the
  `(document_id, page_number)` unique index — safe no-op).
- **Grounded chunks.** Every `document_chunks` row carries `page_id` +
  `page_number` so the AI chat's RAG retriever can cite "page 42 of the
  arch set" instead of "somewhere in that PDF".
