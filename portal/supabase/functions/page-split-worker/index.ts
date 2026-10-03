// Supabase Edge Function: page-split-worker
// Deno runtime.
//
// Contract — two input modes, sharing the SAME `original_path` field
// (`originals/{document_id}.pdf` in both cases) so the rest of the pipeline
// never needs to know which route created the document:
//   Drive-imported (from /api/documents/import-drive):
//     POST { document_id, tenant_id, project_id, drive_file_id, original_path,
//            access_token, user_id }
//   Local direct-upload (from /api/takeoff/from-document, large uploads):
//     POST { document_id, tenant_id, project_id, original_path,
//            is_local_upload: true, user_id }
//   Mode is decided by `!body.drive_file_id` — no `drive_file_id` means the
//   browser already PUT the original PDF straight into
//   `plans-bucket/{original_path}`, so the Drive fetch step is skipped
//   entirely and we just read it back from our own storage.
//
// Pipeline:
//   1. Get the original PDF bytes — either streamed from Google Drive (and
//      copied into `plans-bucket/{original_path}`), or read directly from
//      `plans-bucket/{original_path}` if it's already there (local uploads /
//      continuation batches).
//   2. Load the PDF via pdf-lib.
//   3. Update `documents.page_count`.
//   4. Burst a PAGE_BATCH of pages (concurrent uploads) into standalone
//      1-page PDFs at `plans-bucket/pages/{document_id}/page-{n}.pdf`.
//   5. Insert `document_pages` rows (status="pending") for this batch.
//   6. Enqueue each page for BOTH `page-processor` and `page-takeoff-worker`
//      (pooled fan-out). If more pages remain, self-invoke with `page_from`
//      so 500+ decks finish under the Edge wall-clock.
//
// This function must be deployed with `supabase functions deploy page-split-worker`
// and needs env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANS_BUCKET (default "plans-bucket").

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import {
  DEFAULT_FANOUT_CONCURRENCY,
  DEFAULT_PAGE_BATCH,
  DEFAULT_UPLOAD_CONCURRENCY,
  computePageBatchRange,
  shouldClearPages,
  shouldReadOriginalFromStorage,
} from "../_shared/splitBatch.ts";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
/** Parallel page PDF uploads — keeps large decks under the Edge wall-clock. */
const UPLOAD_CONCURRENCY = Math.max(1, Number(Deno.env.get("SPLIT_UPLOAD_CONCURRENCY") ?? String(DEFAULT_UPLOAD_CONCURRENCY)) || DEFAULT_UPLOAD_CONCURRENCY);
/** Max page-worker fan-out fetches in flight at once (OCR + takeoff each count). */
const FANOUT_CONCURRENCY = Math.max(2, Number(Deno.env.get("SPLIT_FANOUT_CONCURRENCY") ?? String(DEFAULT_FANOUT_CONCURRENCY)) || DEFAULT_FANOUT_CONCURRENCY);
/** Pages per Edge invocation before self-chaining (500+ page decks). */
const PAGE_BATCH = Math.max(10, Number(Deno.env.get("SPLIT_PAGE_BATCH") ?? String(DEFAULT_PAGE_BATCH)) || DEFAULT_PAGE_BATCH);
const INSERT_CHUNK = 100;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

// Google Drive occasionally 429/5xx's under load; retry with exponential
// backoff rather than failing the whole document on a transient blip.
async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3, timeoutMs = 45_000): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(`timeout after ${timeoutMs} ms`), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

interface Payload {
  document_id: string;
  tenant_id: string;
  project_id: string;
  drive_file_id?: string;
  original_path: string;
  access_token?: string;
  is_local_upload?: boolean;
  source_bucket?: string;
  user_id: string;
  /** 1-based inclusive start page for this batch (continuation). */
  page_from?: number;
  /** When false, keep existing document_pages (continuation batches). */
  clear_pages?: boolean;
}

Deno.serve(async (req) => {
  const started = Date.now();
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const pageFrom = Math.max(1, Math.floor(Number(body.page_from) || 1));
  const isContinuation = pageFrom > 1;
  // Continuation batches always read the original from Storage (first batch
  // already copied Drive bytes into plans-bucket).
  const fromStorage = shouldReadOriginalFromStorage(pageFrom, Boolean(body.drive_file_id));
  if (!fromStorage && !body.access_token) {
    return new Response(JSON.stringify({ error: "access_token is required when drive_file_id is set" }), { status: 400 });
  }
  if (!body.original_path) {
    return new Response(JSON.stringify({ error: "original_path is required" }), { status: 400 });
  }
  const clearPages = shouldClearPages(pageFrom, body.clear_pages);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function recordEvent(status: "started" | "succeeded" | "failed" | "skipped", errorMessage?: string): Promise<void> {
    await db.from("document_processing_events").insert({
      tenant_id: body.tenant_id,
      project_id: body.project_id,
      document_id: body.document_id,
      document_page_id: null,
      step: "split",
      status,
      worker: "page-split-worker",
      error_message: errorMessage?.slice(0, 2000) ?? null,
      completed_at: status === "started" ? null : new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }

  // Mark the document as processing right away so the UI can reflect status.
  await db.from("documents")
    .update({ status: "processing", split_status: "processing" })
    .eq("id", body.document_id)
    .eq("tenant_id", body.tenant_id);
  await recordEvent("started", isContinuation ? `continuation from page ${pageFrom}` : undefined);

  try {
    // ── 1. Get original PDF bytes ────────────────────────────────────────────
    let originalBytes: Uint8Array;
    if (fromStorage) {
      // Local direct-upload — the browser already PUT the original here.
      // Skip the Drive fetch step completely and just read it back.
      const sourceBucket = body.source_bucket === "project-documents" || body.source_bucket === PLANS_BUCKET
        ? body.source_bucket
        : PLANS_BUCKET;
      const dl = await db.storage.from(sourceBucket).download(body.original_path);
      if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);
      originalBytes = new Uint8Array(await dl.data.arrayBuffer());
    } else {
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.drive_file_id!)}?alt=media`;
      const driveRes = await fetchWithRetry(driveUrl, {
        headers: { Authorization: `Bearer ${body.access_token}` },
      });
      if (!driveRes.ok || !driveRes.body) {
        throw new Error(`Drive fetch ${driveRes.status}: ${(await driveRes.text().catch(() => "")).slice(0, 200)}`);
      }
      // Buffer the response (Supabase JS upload wants a Blob/ArrayBuffer, not a stream).
      originalBytes = new Uint8Array(await driveRes.arrayBuffer());

      const upOrig = await db.storage.from(PLANS_BUCKET)
        .upload(body.original_path, originalBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upOrig.error) throw new Error(`upload original: ${upOrig.error.message}`);
    }

    // ── 2. Load PDF ──────────────────────────────────────────────────────────
    const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const pageCount = pdf.getPageCount();

    // ── 3. page_count ────────────────────────────────────────────────────────
    await db.from("documents")
      .update({ page_count: pageCount })
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);

    // ── 4-5. Burst + insert document_pages (batched for 500+ decks) ──────────
    // Concurrent uploads (default 8) + page batches with self-continuation
    // keep wall-clock under the Edge duration ceiling.
    if (pageCount === 0) throw new Error("PDF has zero pages");
    if (pageFrom > pageCount) {
      throw new Error(`page_from ${pageFrom} exceeds page_count ${pageCount}`);
    }

    type PageRow = {
      id: string; tenant_id: string; document_id: string; page_number: number;
      storage_path: string; status: string;
    };

    // Bound this invocation to PAGE_BATCH pages; remaining pages chain via
    // a self-invoke so 500+ decks stay under the Edge wall-clock.
    const batch = computePageBatchRange(pageFrom, pageCount, PAGE_BATCH);
    const pageIndexes = batch.pageIndexes;
    const pageTo = batch.pageTo;
    const hasMore = batch.hasMore;
    const nextPageFrom = batch.nextPageFrom ?? pageTo + 1;

    const uploadResults = await mapPool(pageIndexes, UPLOAD_CONCURRENCY, async (i) => {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(pdf, [i]);
      single.addPage(copied);
      const pageBytes = await single.save();
      const pageNumber = i + 1;
      const storagePath = `pages/${body.document_id}/page-${pageNumber}.pdf`;
      const upPage = await db.storage.from(PLANS_BUCKET)
        .upload(storagePath, pageBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upPage.error) {
        console.warn(`[page-split] upload page ${pageNumber} failed: ${upPage.error.message}`);
        return null;
      }
      const row: PageRow = {
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        document_id: body.document_id,
        page_number: pageNumber,
        storage_path: storagePath,
        status: "pending",
      };
      return row;
    });
    const pageRows = uploadResults.filter((r): r is PageRow => r != null);
    const batchFailed = pageIndexes.length - pageRows.length;

    if (pageRows.length === 0) {
      throw new Error(`All ${pageIndexes.length} page upload(s) in batch failed — nothing to process`);
    }

    // First batch (or rekick): clear prior rows. Continuations append.
    if (clearPages) {
      const { error: delErr } = await db.from("document_pages")
        .delete()
        .eq("document_id", body.document_id)
        .eq("tenant_id", body.tenant_id);
      if (delErr) throw new Error(`clear document_pages: ${delErr.message}`);
    } else if (pageRows.length > 0) {
      // Drop any stale rows for this page range so UNIQUE doesn't fail on retry.
      const nums = pageRows.map((p) => p.page_number);
      const { error: delRangeErr } = await db.from("document_pages")
        .delete()
        .eq("document_id", body.document_id)
        .eq("tenant_id", body.tenant_id)
        .in("page_number", nums);
      if (delRangeErr) throw new Error(`clear page range: ${delRangeErr.message}`);
    }

    for (let i = 0; i < pageRows.length; i += INSERT_CHUNK) {
      const chunk = pageRows.slice(i, i + INSERT_CHUNK);
      const { error: insErr } = await db.from("document_pages").insert(chunk);
      if (insErr) throw new Error(`insert document_pages: ${insErr.message}`);
    }

    // ── 6. Fan out page jobs; keep isolate alive until kicks are sent ───────
    // Returning before the fetches leave the isolate can drop OCR/takeoff
    // enqueues on cold Edge isolates. waitUntil keeps them alive without
    // blocking the portal's HTTP response on OCR completion.
    // Fan-out is concurrency-limited so a 500-page deck doesn't open 1000
    // simultaneous outbound fetches from one isolate.
    const base = SUPABASE_URL.replace(/\/$/, "");
    const processorUrl = `${base}/functions/v1/page-processor`;
    const takeoffWorkerUrl = `${base}/functions/v1/page-takeoff-worker`;
    const selfUrl = `${base}/functions/v1/page-split-worker`;
    const fanoutJobs = pageRows.length * 2;
    const fanoutTargets = pageRows.flatMap((p) => [
      { kind: "processor" as const, page: p },
      { kind: "takeoff" as const, page: p },
    ]);
    const fanout = mapPool(fanoutTargets, FANOUT_CONCURRENCY, async (job) => {
      const url = job.kind === "processor" ? processorUrl : takeoffWorkerUrl;
      try {
        await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            page_id: job.page.id,
            document_id: job.page.document_id,
            tenant_id: job.page.tenant_id,
            project_id: body.project_id,
            page_number: job.page.page_number,
            storage_path: job.page.storage_path,
          }),
        });
      } catch (err) {
        console.warn(`[page-split] ${job.kind} enqueue failed page ${job.page.page_number}`, err);
      }
    });

    const continueSplit = hasMore
      ? fetch(selfUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            document_id: body.document_id,
            tenant_id: body.tenant_id,
            project_id: body.project_id,
            original_path: body.original_path,
            source_bucket: body.source_bucket,
            user_id: body.user_id,
            is_local_upload: true,
            page_from: nextPageFrom,
            clear_pages: false,
          }),
        }).then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn(`[page-split] continuation kick failed: ${res.status} ${text.slice(0, 200)}`);
          }
        }).catch((err) => {
          console.warn("[page-split] continuation kick error", err);
        })
      : Promise.resolve();

    // EdgeRuntime is injected by the Supabase Edge runtime.
    // deno-lint-ignore no-explicit-any
    const edgeWaitUntil = (globalThis as any).EdgeRuntime?.waitUntil as
      | ((p: Promise<unknown>) => void)
      | undefined;
    const background = Promise.all([fanout, continueSplit]);
    if (typeof edgeWaitUntil === "function") {
      edgeWaitUntil(background);
    } else {
      // Local/dev fallback — don't block the response path in production.
      void background;
    }

    const { data: docMetaRow } = await db
      .from("documents")
      .select("meta")
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .maybeSingle();
    const prevMeta = (docMetaRow?.meta && typeof docMetaRow.meta === "object")
      ? docMetaRow.meta as Record<string, unknown>
      : {};
    const prevSummary = (typeof prevMeta.processing_summary === "object" && prevMeta.processing_summary)
      ? prevMeta.processing_summary as Record<string, unknown>
      : {};
    const prevEnqueued = typeof prevSummary.pages_enqueued === "number" ? prevSummary.pages_enqueued : 0;
    const prevFailed = typeof prevSummary.failed_uploads === "number" ? prevSummary.failed_uploads : 0;
    const pagesEnqueuedTotal = (isContinuation ? prevEnqueued : 0) + pageRows.length;
    const failedUploadsTotal = (isContinuation ? prevFailed : 0) + batchFailed;

    if (hasMore) {
      // Mid-split: stay in processing; UI polls until continuation finishes.
      // Refresh processing_started_at so multi-batch 500+ decks aren't
      // reclaimed mid-chain by the stuck-processing timeout.
      await db.from("documents")
        .update({
          status: "processing",
          split_status: "processing",
          page_count: pageCount,
          processing_started_at: new Date().toISOString(),
          meta: {
            ...prevMeta,
            processing_summary: {
              ...prevSummary,
              pages_enqueued: pagesEnqueuedTotal,
              pages_split_through: pageTo,
              pages_total: pageCount,
              fanout_jobs: fanoutJobs,
              fanout_mode: "pooled_fire_and_forget",
              upload_concurrency: UPLOAD_CONCURRENCY,
              fanout_concurrency: FANOUT_CONCURRENCY,
              page_batch: PAGE_BATCH,
              failed_uploads: failedUploadsTotal,
              continued: true,
              next_page_from: nextPageFrom,
              updated_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", body.document_id)
        .eq("tenant_id", body.tenant_id);
      await recordEvent("succeeded", `batch ok; pages ${pageFrom}-${pageTo}/${pageCount}; continuing`);
      return new Response(JSON.stringify({
        ok: true,
        continued: true,
        document_id: body.document_id,
        page_count: pageCount,
        page_from: pageFrom,
        page_to: pageTo,
        pages_enqueued: pageRows.length,
        next_page_from: nextPageFrom,
        fanout_jobs: fanoutJobs,
        elapsed_ms: Date.now() - started,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Final batch — pages are now the unit of work.
    await db.from("documents")
      .update({
        status: "split",
        split_status: "done",
        page_count: pageCount,
        meta: {
          ...prevMeta,
          processing_summary: {
            ...prevSummary,
            pages_enqueued: pagesEnqueuedTotal,
            pages_split_through: pageCount,
            pages_total: pageCount,
            fanout_jobs: fanoutJobs,
            fanout_mode: "pooled_fire_and_forget",
            upload_concurrency: UPLOAD_CONCURRENCY,
            fanout_concurrency: FANOUT_CONCURRENCY,
            page_batch: PAGE_BATCH,
            failed_uploads: failedUploadsTotal,
            continued: isContinuation,
            updated_at: new Date().toISOString(),
          },
        },
        ...(failedUploadsTotal > 0
          ? {
              last_error: `${failedUploadsTotal} of ${pageCount} pages failed to upload`,
              last_error_step: "split",
            }
          : {
              last_error: null,
              last_error_step: null,
            }),
      })
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);
    const { error: summaryErr } = await db.rpc("refresh_document_processing_summary", {
      p_document_id: body.document_id,
    });
    if (summaryErr) console.warn("[page-split] summary refresh failed", summaryErr.message);
    await recordEvent("succeeded", `split ok; ${pagesEnqueuedTotal} pages enqueued`);

    return new Response(JSON.stringify({
      ok: true,
      continued: false,
      document_id: body.document_id,
      page_count: pageCount,
      page_from: pageFrom,
      page_to: pageTo,
      pages_enqueued: pageRows.length,
      pages_enqueued_total: pagesEnqueuedTotal,
      fanout_jobs: fanoutJobs,
      elapsed_ms: Date.now() - started,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("[page-split-worker]", err);
    await recordEvent("failed", String(err?.message ?? err));
    await db.from("documents")
      .update({
        status: "error",
        split_status: "error",
        last_error: String(err?.message ?? err).slice(0, 2000),
        last_error_step: "split",
      })
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 });
  }
});
