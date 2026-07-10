# Document Pipeline Audit

Two entirely separate, non-integrated ingestion paths exist.

## Path 1: Whole-document, single-shot (`app/api/documents/[id]/ingest/route.ts`)

Upload (`app/api/documents/upload/route.ts`) writes bytes to `project-documents` bucket, inserts a `documents` row tagged with revision metadata (`buildDocumentRevisionMeta`), then fires an **unawaited, error-swallowed** POST to `/api/documents/{id}/ingest` (`.catch(() => {})`).

The ingest route uploads the whole PDF to Gemini Files API, waits for ACTIVE (60s timeout), does one `generateContent` call for extraction+classification, inserts `pages`/`chunks` rows, marks `documents.status="complete"`.

**No retry/backoff anywhere in this file.** A single Gemini or embedding failure anywhere in the sequence throws, is caught once, calls `markError()` — the whole document is abandoned. `maxDuration=300` (5 min Vercel ceiling); if a large document's sequential embedding loop exceeds that, Vercel kills the function mid-flight, `markError()` never runs, and the document is **stuck in "processing" forever with no visible failure** — a silent-hang defect.

Upload dedup for Drive-imported documents does a check-then-insert on `(tenant_id, project_id, drive_file_id)` with the code's own comment admitting "the race-proof partial unique index isn't applied to the DB yet" — a genuine TOCTOU race under concurrent identical uploads.

## Path 2: Async page-split pipeline (Edge Functions)

1. `page-split-worker` — marks `documents.status="processing"`, downloads bytes, loads via `pdf-lib`, **iterates pages sequentially** (explicit code comment flags 500+ page sets as an unaddressed risk against the ~150s Edge Function ceiling), bulk-inserts `document_pages`, fans out to `page-processor` and `page-takeoff-worker` per page via `Promise.allSettled` (individual failures swallowed — never inspected), sets `documents.status="split"`.
2. `page-processor` — real exponential-backoff retry (`fetchWithRetry`, 3 attempts) on both the Gemini call and the embed batch call. Sets `document_pages.status` per-page (not per-document, so one page's failure doesn't kill siblings). **Soft failure mode:** embed failures return `null` embeddings rather than throwing — the page is marked "done" even though its chunks are unsearchable via vector search. Silent partial degradation.
3. `page-takeoff-worker` — same retry pattern, calling Railway's `/api/takeoff/extract`. Confirmed the `takeoff_status` vs. `status` column-separation claim is real and correctly implemented (the two workers only ever write disjoint columns, so there's no read-modify-write race). On failure, sets `takeoff_status="error"` **per-page only** — does not propagate to `documents.status` or abort sibling pages. A 200-page set can have 40 silently-failed pages with zero document-level indication unless the caller polls and aggregates (`TakeoffTab.tsx`'s `pollSplitStatus` does this).

## Silent failures / risks — consolidated

| Risk | Location | Severity |
|---|---|---|
| Whole-document ingest can hang forever on Vercel timeout with no error state | `app/api/documents/[id]/ingest/route.ts`, `maxDuration=300` | High |
| Page-level takeoff/OCR failures invisible at document level unless polled | `page-split-worker`'s `Promise.allSettled` fan-out never inspected | Medium-High |
| Embed failures silently produce unsearchable chunks marked "done" | `page-processor/index.ts` | Medium |
| TOCTOU race on Drive-import dedup | `documents/upload/route.ts` (admitted in code comment) | Medium |
| 500+ page plan sets risk exceeding Edge Function duration ceiling | `page-split-worker/index.ts` (admitted in code comment) | Medium (explicitly acknowledged, unaddressed) |
| Two separate ingestion pipelines with different retry/error semantics for the same conceptual operation | Path 1 vs. Path 2 above | Structural |

## Revision tracking

Real but soft — filename-parsed only (see DATABASE_AUDIT.md). Every upload creates an unrelated `documents` row; there is no FK-based supersession chain. If a re-upload's filename doesn't match the expected slug pattern, it silently becomes an unrelated, ungrouped document with no way to detect it's a revision of an existing one.

## Contact extraction

**Confirmed standalone, not wired into either ingestion path.** `/api/contacts/parse` accepts pasted text only, runs one AI call, returns candidates for manual review (does not auto-save). No document-processing route or Edge Function calls it. It is a manual "paste and extract" tool, disconnected from the actual plan-upload pipeline entirely — despite the product spec treating document-driven contact extraction as foundational.

## File-size / timeout limits found

- `documents/upload/route.ts` / `[id]/ingest/route.ts`: `maxDuration = 300` (5 min Vercel ceiling)
- `page-split-worker`: ~150s Supabase Edge Function ceiling, explicitly flagged by its own code comment as a risk for 500+ page sets
- `takeoff/extract/route.ts`: `maxDuration = 300`
- Direct-upload threshold: 3.5MB in `TakeoffTab.tsx`, routing larger files through a signed two-step upload to avoid Vercel's ~4.5MB multipart ingress ceiling
- AI vision fallback hard-caps at 32MB
