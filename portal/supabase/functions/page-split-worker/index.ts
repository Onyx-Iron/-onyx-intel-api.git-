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
//      `plans-bucket/{original_path}` if it's already there (local uploads).
//   2. Load the PDF via pdf-lib.
//   3. Update `documents.page_count`.
//   4. Burst each page into a standalone 1-page PDF at
//      `plans-bucket/pages/{document_id}/page-{n}.pdf`.
//   5. Insert `document_pages` rows (status="pending").
//   6. Enqueue each page for BOTH `page-processor` (OCR + embeddings, for
//      document Q&A/search) and `page-takeoff-worker` (real CSI takeoff rows,
//      for the estimate grid) — fire-and-forget, per page.
//
// This function must be deployed with `supabase functions deploy page-split-worker`
// and needs env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANS_BUCKET (default "plans-bucket").

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";

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
  user_id: string;
}

Deno.serve(async (req) => {
  const started = Date.now();
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  // No drive_file_id means this is a local direct-upload: the browser already
  // PUT the original PDF into plans-bucket/{original_path} itself.
  const fromStorage = !body.drive_file_id;
  if (!fromStorage && !body.access_token) {
    return new Response(JSON.stringify({ error: "access_token is required when drive_file_id is set" }), { status: 400 });
  }
  if (!body.original_path) {
    return new Response(JSON.stringify({ error: "original_path is required" }), { status: 400 });
  }

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
    .update({ status: "processing" })
    .eq("id", body.document_id)
    .eq("tenant_id", body.tenant_id);
  await recordEvent("started");

  try {
    // ── 1. Get original PDF bytes ────────────────────────────────────────────
    let originalBytes: Uint8Array;
    if (fromStorage) {
      // Local direct-upload — the browser already PUT the original here.
      // Skip the Drive fetch step completely and just read it back.
      const dl = await db.storage.from(PLANS_BUCKET).download(body.original_path);
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

    // ── 4-5. Burst + insert document_pages ───────────────────────────────────
    const pageRows: Array<{
      id: string; tenant_id: string; document_id: string; page_number: number;
      storage_path: string; status: string;
    }> = [];

    // pdf-lib doesn't stream; iterate sequentially. For huge decks (500+ pages)
    // we may want to batch these uploads later, but for typical 20-200 page
    // plansets this is well within the 150s Edge Function ceiling.
    let failedUploads = 0;
    for (let i = 0; i < pageCount; i++) {
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
        failedUploads += 1;
        continue;
      }

      pageRows.push({
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        document_id: body.document_id,
        page_number: pageNumber,
        storage_path: storagePath,
        status: "pending",
      });
    }

    if (pageRows.length === 0) {
      throw new Error(
        pageCount === 0
          ? "PDF has zero pages"
          : `All ${pageCount} page upload(s) failed — nothing to process`,
      );
    }

    // Retry / rekick can re-run split for the same document — clear prior
    // page rows so UNIQUE(document_id, page_number) doesn't fail the job.
    {
      const { error: delErr } = await db.from("document_pages")
        .delete()
        .eq("document_id", body.document_id)
        .eq("tenant_id", body.tenant_id);
      if (delErr) throw new Error(`clear document_pages: ${delErr.message}`);
      const { error: insErr } = await db.from("document_pages").insert(pageRows);
      if (insErr) throw new Error(`insert document_pages: ${insErr.message}`);
    }

    // ── 6. Fan out page jobs; keep isolate alive until kicks are sent ───────
    // Returning before the fetches leave the isolate can drop OCR/takeoff
    // enqueues on cold Edge isolates. waitUntil keeps them alive without
    // blocking the portal's HTTP response on OCR completion.
    const base = SUPABASE_URL.replace(/\/$/, "");
    const processorUrl = `${base}/functions/v1/page-processor`;
    const takeoffWorkerUrl = `${base}/functions/v1/page-takeoff-worker`;
    const fanoutJobs = pageRows.length * 2;
    const fanout = Promise.allSettled(pageRows.flatMap((p) => [
      fetch(processorUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_id: p.id,
          document_id: p.document_id,
          tenant_id: p.tenant_id,
          page_number: p.page_number,
          storage_path: p.storage_path,
        }),
      }).catch((err) => console.warn(`[page-split] processor enqueue failed page ${p.page_number}`, err)),
      fetch(takeoffWorkerUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_id: p.id,
          document_id: p.document_id,
          tenant_id: p.tenant_id,
          project_id: body.project_id,
          page_number: p.page_number,
          storage_path: p.storage_path,
        }),
      }).catch((err) => console.warn(`[page-split] takeoff enqueue failed page ${p.page_number}`, err)),
    ]));
    // EdgeRuntime is injected by the Supabase Edge runtime.
    // deno-lint-ignore no-explicit-any
    const edgeWaitUntil = (globalThis as any).EdgeRuntime?.waitUntil as
      | ((p: Promise<unknown>) => void)
      | undefined;
    if (typeof edgeWaitUntil === "function") {
      edgeWaitUntil(fanout);
    } else {
      // Local/dev fallback — don't block the response path in production.
      void fanout;
    }

    // Mark documents.status="split" — pages are now the unit of work.
    const { data: docMetaRow } = await db
      .from("documents")
      .select("meta")
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .maybeSingle();
    const prevMeta = (docMetaRow?.meta && typeof docMetaRow.meta === "object")
      ? docMetaRow.meta as Record<string, unknown>
      : {};
    await db.from("documents")
      .update({
        status: "split",
        split_status: "done",
        page_count: pageCount,
        meta: {
          ...prevMeta,
          processing_summary: {
            pages_enqueued: pageRows.length,
            fanout_jobs: fanoutJobs,
            fanout_mode: "fire_and_forget",
            failed_uploads: failedUploads,
            updated_at: new Date().toISOString(),
          },
        },
        ...(failedUploads > 0
          ? {
              last_error: `${failedUploads} of ${pageCount} pages failed to upload`,
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
    await recordEvent("succeeded", `split ok; ${pageRows.length} pages enqueued`);

    return new Response(JSON.stringify({
      ok: true,
      document_id: body.document_id,
      page_count: pageCount,
      pages_enqueued: pageRows.length,
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
