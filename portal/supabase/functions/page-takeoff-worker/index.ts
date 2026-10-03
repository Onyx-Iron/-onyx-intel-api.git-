// Supabase Edge Function: page-takeoff-worker
// Deno runtime.
//
// Runs REAL takeoff extraction (CSI cost codes, quantities) on one already-
// split page PDF, in parallel with page-processor's OCR/embedding step.
// page-processor exists for document Q&A/search (document_chunks); this
// function is what actually populates `takeoff_items` for the estimate grid
// — without it, routing large uploads through the async split pipeline would
// "complete" successfully while producing zero takeoff rows.
//
// Contract (invoked by page-split-worker, one call per page):
//   POST { page_id, document_id, tenant_id, project_id, page_number, storage_path }
//
// Pipeline:
//   1. Download the single-page PDF from `plans-bucket/{storage_path}`.
//   2. POST it to the Railway takeoff service's `/api/takeoff/extract`
//      (deterministic + AI-vision fallback, same engine the synchronous
//      path uses) — one page per call, so it's always well within any
//      request time ceiling regardless of the source document's size.
//   3. Insert returned rows into `takeoff_items`, tagged with page_number +
//      document_id so multi-page results all land in the same project.
//   4. Update `document_pages.takeoff_status` = "done" | "error" for this
//      page. This is a DEDICATED column, distinct from `status` (which
//      page-processor's OCR/embedding step owns) — two independent workers
//      writing the same column would race and corrupt each other's result.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANS_BUCKET (default "plans-bucket"),
//   PYTHON_API_URL (Railway base URL), ONYX_API_SECRET (X-Onyx-Secret value).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureException } from "../_shared/errors.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET     = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
const PYTHON_API_URL   = (Deno.env.get("PYTHON_API_URL") ?? "").replace(/\/$/, "");
const ONYX_API_SECRET  = Deno.env.get("ONYX_API_SECRET") ?? "";

interface Payload {
  page_id: string;
  document_id: string;
  tenant_id: string;
  project_id: string;
  page_number: number;
  storage_path: string;
}

// Railway service occasionally cold-starts or briefly 5xx's under load;
// retry with exponential backoff rather than failing the whole page.
async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3, timeoutMs = 60_000): Promise<Response> {
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

interface TakeoffRow {
  trade?: string;
  cost_code?: string;
  description?: string;
  quantity_basis?: string;
  total_qty?: number;
  uom?: string;
  drawing_ref?: string | null;
  location_tag?: string | null;
  extraction_method?: "deterministic" | "ai_vision";
  confidence?: number | null;
}

// Page extraction does not price estimate lines. The portal outbox worker
// runs syncTakeoffToEstimate, which is the only writer of versioned
// labor, material, and equipment totals.

// deno-lint-ignore no-explicit-any
async function enqueueProjectEstimateSync(
  db: any,
  tenantId: string,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.rpc("enqueue_project_estimate_sync", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
    p_payload: payload,
  });
  if (error) throw new Error(`enqueue estimate sync: ${error.message}`);
}

Deno.serve(async (req) => {
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function recordEvent(status: "started" | "succeeded" | "failed" | "skipped", errorMessage?: string): Promise<void> {
    await db.from("document_processing_events").insert({
      tenant_id: body.tenant_id,
      project_id: body.project_id,
      document_id: body.document_id,
      document_page_id: body.page_id,
      step: "takeoff",
      status,
      worker: "page-takeoff-worker",
      error_message: errorMessage?.slice(0, 2000) ?? null,
      completed_at: status === "started" ? null : new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }
  async function refreshDocumentSummary(): Promise<void> {
    const { error } = await db.rpc("refresh_document_processing_summary", {
      p_document_id: body.document_id,
    });
    if (error) console.warn("[page-takeoff-worker] summary refresh failed", error.message);
  }

  await db.from("document_pages")
    .update({ takeoff_status: "processing" })
    .eq("id", body.page_id)
    .eq("tenant_id", body.tenant_id);
  await recordEvent("started");

  try {
    const { data: sourceDoc } = await db
      .from("documents")
      .select("doc_type, status, meta")
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .maybeSingle();
    const docType = String(sourceDoc?.doc_type ?? "").toLowerCase();
    const partialOpen = sourceDoc?.status === "complete_with_errors"
      && sourceDoc?.meta?.partial_acknowledged !== true;
    if ((docType && docType !== "drawing") || partialOpen) {
      await db.from("document_pages")
        .update({ takeoff_status: "skipped", updated_at: new Date().toISOString() })
        .eq("id", body.page_id)
        .eq("tenant_id", body.tenant_id);
      const reason = partialOpen
        ? "Takeoff skipped until missing pages are retried or acknowledged."
        : "Specs and other non-drawing files do not emit quantities.";
      await recordEvent("skipped", reason);
      await refreshDocumentSummary();
      return new Response(JSON.stringify({ ok: true, skipped: true, reason }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!PYTHON_API_URL) throw new Error("PYTHON_API_URL is not configured for this function");

    // ── 1. Download the single-page PDF ─────────────────────────────────────
    const dl = await db.storage.from(PLANS_BUCKET).download(body.storage_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);

    // ── 2. Run takeoff extraction on just this page ─────────────────────────
    const form = new FormData();
    form.append("file", dl.data, `page-${body.page_number}.pdf`);

    const res = await fetchWithRetry(`${PYTHON_API_URL}/api/takeoff/extract`, {
      method: "POST",
      headers: {
        "X-Onyx-Secret": ONYX_API_SECRET,
        "X-Onyx-Tenant": body.tenant_id,
        "X-Onyx-Project": body.project_id,
      },
      body: form,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      throw new Error(`takeoff extract ${res.status}: ${detail}`);
    }
    const data = await res.json() as { rows?: TakeoffRow[] };
    const rows = (Array.isArray(data.rows) ? data.rows : []).filter((row) => row.extraction_method !== "ai_vision");

    // ── 3. Insert into takeoff_items ─────────────────────────────────────────
    if (rows.length > 0) {
      const payload = rows.map((r) => ({
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        project_id: body.project_id,
        label: r.description || r.trade || "Untitled item",
        csi_code: r.cost_code ?? null,
        division: r.cost_code ? r.cost_code.slice(0, 2) : null,
        quantity: r.total_qty ?? null,
        unit: r.uom ?? null,
        type: "takeoff_import",
        page: body.page_number,
        document_id: body.document_id,
        sheet_id: body.page_id,
        // Deterministic rows (PDF table/DXF/IFC/XLSX math) are grounded in
        // real source data and implicitly approved; ai_vision rows are an
        // unverified suggestion and must wait for a human review action
        // before they can reach the estimate. The outbox sync skips them.
        created_by: null,
        review_status: r.extraction_method === "ai_vision" ? "suggested" : "approved",
        source_method: r.extraction_method ?? "deterministic",
        // OSS-04 provenance: agent vs deterministic_parser vs human.
        origin_actor: r.extraction_method === "ai_vision" ? "agent" : "deterministic_parser",
        origin_method: r.extraction_method ?? "deterministic",
        origin_edited: false,
        confidence_score: r.confidence ?? null,
        meta: {
          trade: r.trade ?? null,
          quantity_basis: r.quantity_basis ?? null,
          drawing_ref: r.drawing_ref ?? null,
          location_tag: r.location_tag ?? null,
          extraction_method: r.extraction_method ?? "deterministic",
          origin_actor: r.extraction_method === "ai_vision" ? "agent" : "deterministic_parser",
          origin_method: r.extraction_method ?? "deterministic",
        },
      }));
      const { data: insertedRows, error: insErr } = await db.from("takeoff_items").insert(payload).select("id,review_status");
      if (insErr) throw new Error(`insert takeoff_items: ${insErr.message}`);

      // Lifecycle audit trail (mirrors lib/takeoff/history.ts — Deno can't
      // import that module, so this is a small inline equivalent).
      if (insertedRows && insertedRows.length > 0) {
        await db.from("takeoff_item_history").insert(
          insertedRows.map((r: { id: string }) => ({
            tenant_id: body.tenant_id,
            project_id: body.project_id,
            takeoff_item_id: r.id,
            action: "created",
            actor_user_id: null,
            after: { source: "page_takeoff_worker" },
          })),
        );
      }

      // Queue the portal estimate sync. It writes the draft version.
      await enqueueProjectEstimateSync(db, body.tenant_id, body.project_id, {
        document_id: body.document_id,
        page_id: body.page_id,
      });
    }

    // ── 4. Done ───────────────────────────────────────────────────────────────
    await db.from("document_pages")
      .update({ takeoff_status: "done", updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    await recordEvent("succeeded");
    await refreshDocumentSummary();

    return new Response(JSON.stringify({ ok: true, page_id: body.page_id, rows: rows.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    captureException(err, { fn: "page-takeoff-worker", page_id: body?.page_id });
    console.error("[page-takeoff-worker]", err);
    const message = String(err?.message ?? err);
    await recordEvent("failed", message);
    await db.from("document_pages")
      .update({ takeoff_status: "error", takeoff_error: String(err?.message ?? err).slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    await refreshDocumentSummary();
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
