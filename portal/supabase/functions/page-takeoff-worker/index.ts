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

  await db.from("document_pages")
    .update({ takeoff_status: "processing" })
    .eq("id", body.page_id)
    .eq("tenant_id", body.tenant_id);

  try {
    if (!PYTHON_API_URL) throw new Error("PYTHON_API_URL is not configured for this function");

    // ── 1. Download the single-page PDF ─────────────────────────────────────
    const dl = await db.storage.from(PLANS_BUCKET).download(body.storage_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);

    // ── 2. Run takeoff extraction on just this page ─────────────────────────
    const form = new FormData();
    form.append("file", dl.data, `page-${body.page_number}.pdf`);

    const res = await fetch(`${PYTHON_API_URL}/api/takeoff/extract`, {
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
    const rows = Array.isArray(data.rows) ? data.rows : [];

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
        meta: {
          trade: r.trade ?? null,
          quantity_basis: r.quantity_basis ?? null,
          drawing_ref: r.drawing_ref ?? null,
          location_tag: r.location_tag ?? null,
          extraction_method: r.extraction_method ?? "deterministic",
        },
      }));
      const { error: insErr } = await db.from("takeoff_items").insert(payload);
      if (insErr) throw new Error(`insert takeoff_items: ${insErr.message}`);
    }

    // ── 4. Done ───────────────────────────────────────────────────────────────
    await db.from("document_pages")
      .update({ takeoff_status: "done", updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);

    return new Response(JSON.stringify({ ok: true, page_id: body.page_id, rows: rows.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[page-takeoff-worker]", err);
    await db.from("document_pages")
      .update({ takeoff_status: "error", takeoff_error: String(err?.message ?? err).slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
