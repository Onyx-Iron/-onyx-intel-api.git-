# Onyx Intel — Supabase Edge Functions

Three functions power the Drive / local upload → page-split → OCR + takeoff pipeline:

| Function               | Trigger                                            | Purpose                                                        |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `page-split-worker`    | Portal `queuePageSplit` / import-drive / from-document | Stream Drive or read Storage → pdf-lib split → insert `document_pages` → fan-out |
| `page-processor`       | Fan-out from `page-split-worker` (one per page)    | Gemini extract → chunk → embed → `document_chunks`             |
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
     GEMINI_EMBED_MODEL="text-embedding-004"
   ```

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

## After merge (deploy gate)

There is no CI deploy for Edge functions. When a PR changes worker source,
redeploy before calling the merge done:

| Paths changed | Redeploy |
| --- | --- |
| `supabase/functions/page-split-worker/**` or `_shared/split-reconcile.ts` / `_shared/splitBatch.ts` | `page-split-worker` |
| `supabase/functions/page-takeoff-worker/**` or `_shared/page-takeoff-idempotency.ts` | `page-takeoff-worker` |
| `supabase/functions/page-processor/**` | `page-processor` |
| `lib/cad/pdf-vector-extract.ts` (imported by split) | `page-split-worker` |
| `_shared/errors.ts` | every function that imports it |

```bash
supabase link --project-ref vvnigrbdsipriufhrwbs
supabase functions deploy page-split-worker
# and/or:
supabase functions deploy page-takeoff-worker
supabase functions deploy page-processor
```

## Ops secrets checklist

- **Integration CI:** GitHub Actions secrets `TEST_SUPABASE_URL` +
  `TEST_SUPABASE_SERVICE_ROLE_KEY` must point at an *isolated* Supabase
  project — never production `vvnigrbdsipriufhrwbs`. Until set, the
  integration job self-skips and stays green without a real gate.
- **Vercel crons** (`portal/vercel.json`): `CRON_SECRET` (and optional
  `INTERNAL_WORKER_SECRET`) must be set on the Vercel project so
  `/api/internal/outbox/process` and related routes accept the cron.
- **GitHub outbox redrive** (`.github/workflows/outbox-redrive.yml`):
  `OUTBOX_APP_URL` + the same `CRON_SECRET` value as Vercel.

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

- **Batched split (500+ pages).** `page-split-worker` uploads pages
  concurrently (`SPLIT_UPLOAD_CONCURRENCY`, default 8), inserts in chunks,
  fans out with a pool (`SPLIT_FANOUT_CONCURRENCY`, default 40), and
  self-chains every `SPLIT_PAGE_BATCH` pages (default 75) via `page_from`
  so large decks stay under the Edge wall-clock. Shared math lives in
  `_shared/splitBatch.ts`.
- **Durable fan-out.** `page-split-worker` enqueues each page to
  `page-processor` and `page-takeoff-worker`, then uses Edge `waitUntil`
  so cold isolates don't drop kicks when the HTTP response returns
  (including the continuation self-invoke).
- **No `display_name`.** Payloads to Gemini's `generateContent` REST
  endpoint deliberately omit `display_name` — it exists only in the Files
  API and the inlineData shape rejects it.
- **Idempotent rekick.** Re-invoking `page-split-worker` reuses existing
  `document_pages` / `sheets` via `reconcileDocumentPages` /
  `reconcileSheets` — it does **not** delete-all pages (that would cascade
  sheet calibrations and orphan takeoff links). Extra pages beyond the new
  page count are removed; OCR/takeoff are re-enqueued only when bytes
  updated and the page is not already done.
- **Grounded chunks.** Every `document_chunks` row carries `page_id` +
  `page_number` so the AI chat's RAG retriever can cite "page 42 of the
  arch set" instead of "somewhere in that PDF".
- **OCR finalize.** Portal `GET /api/documents` rolls settled page OCR
  into `documents.status` (`complete` / `complete_with_errors` / `error`)
  so the Documents UI does not spin forever on `split`.
