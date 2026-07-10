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

// Railway service occasionally cold-starts or briefly 5xx's under load;
// retry with exponential backoff rather than failing the whole page.
async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
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
}

// Mirrors lib/estimating/takeoff-import.ts's buildEstimateImportRows +
// lib/estimating/auto-sync.ts's syncTakeoffToEstimate — duplicated here
// rather than shared because this is a Deno Edge Function, a separate
// runtime from the Next.js app. Keep the two in sync if the fingerprint or
// pricing-resolution logic changes.
function fingerprint(label: string | null, csi: string | null, qty: number | null, unit: string | null, drawingRef: string | null, locationTag: string | null): string {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const normNum = (v: number | null) => (v == null ? "" : String(v));
  return [norm(label), norm(csi), normNum(qty), norm(unit), norm(drawingRef), norm(locationTag)].join("|");
}

// deno-lint-ignore no-explicit-any
async function syncTakeoffToEstimate(db: any, tenantId: string, projectId: string): Promise<void> {
  const [takeoff, existing, catalog] = await Promise.all([
    db.from("takeoff_items").select("id,label,csi_code,division,quantity,unit,type,meta").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("estimate_items").select("source_takeoff_id,source_fingerprint").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("cost_catalog").select("csi_code,uom,unit_cost").eq("tenant_id", tenantId),
  ]);
  if (takeoff.error || existing.error || catalog.error) {
    console.error("[page-takeoff-worker] estimate sync query failed", takeoff.error ?? existing.error ?? catalog.error);
    return;
  }

  const existingKeys = new Set<string>();
  // deno-lint-ignore no-explicit-any
  for (const item of existing.data ?? []) {
    if (item.source_takeoff_id) existingKeys.add(`id:${item.source_takeoff_id}`);
    if (item.source_fingerprint) existingKeys.add(`fp:${item.source_fingerprint}`);
  }

  const costLookup = new Map<string, number>();
  // deno-lint-ignore no-explicit-any
  for (const c of catalog.data ?? []) {
    const cost = c.unit_cost ?? null;
    if (!c.csi_code || cost == null || cost <= 0) continue;
    const uom = (c.uom ?? "").toUpperCase();
    if (uom && !costLookup.has(`${c.csi_code}|${uom}`)) costLookup.set(`${c.csi_code}|${uom}`, cost);
    if (!costLookup.has(`${c.csi_code}|*`)) costLookup.set(`${c.csi_code}|*`, cost);
  }

  const rows: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  for (const t of takeoff.data ?? []) {
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    const drawingRef = typeof meta.drawing_ref === "string" ? meta.drawing_ref : null;
    const locationTag = typeof meta.location_tag === "string" ? meta.location_tag : null;
    const fp = fingerprint(t.label, t.csi_code, t.quantity, t.unit, drawingRef, locationTag);
    if (existingKeys.has(`id:${t.id}`) || existingKeys.has(`fp:${fp}`)) continue;
    existingKeys.add(`fp:${fp}`);

    const uom = (t.unit ?? "").toUpperCase() || null;
    const unitCost = t.csi_code
      ? costLookup.get(`${t.csi_code}|${uom}`) ?? costLookup.get(`${t.csi_code}|*`) ?? null
      : null;
    const aiVision = meta.extraction_method === "ai_vision";

    rows.push({
      tenant_id: tenantId,
      project_id: projectId,
      description: t.label ?? "Takeoff item",
      csi_code: t.csi_code ?? null,
      trade: typeof meta.trade === "string" ? meta.trade : null,
      item_type: "material",
      quantity: t.quantity ?? null,
      uom,
      unit_cost: unitCost,
      source_takeoff_id: t.id,
      source_fingerprint: fp,
      quantity_basis: typeof meta.quantity_basis === "string" ? meta.quantity_basis : null,
      drawing_ref: drawingRef,
      location_tag: locationTag,
      pricing_status: aiVision ? "review" : unitCost != null ? "priced" : "unpriced",
      notes: [
        aiVision ? "Review required: AI vision quantity" : null,
        drawingRef ? `Source: ${drawingRef}` : null,
      ].filter(Boolean).join(" | ") || "Source: takeoff import",
    });
  }

  if (rows.length === 0) return;
  const { error } = await db.from("estimate_items").insert(rows);
  if (error) console.error("[page-takeoff-worker] estimate_items insert failed", error);
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

      // ── 3b. Sync into estimate_items ───────────────────────────────────────
      // Mirrors lib/estimating/auto-sync.ts (Next.js) so large-document
      // extraction (which never touches the portal's Node API) still keeps
      // the estimate in sync automatically instead of requiring the
      // estimator to hit "Import from Takeoff" for pages processed here.
      await syncTakeoffToEstimate(db, body.tenant_id, body.project_id);
    }

    // ── 4. Done ───────────────────────────────────────────────────────────────
    await db.from("document_pages")
      .update({ takeoff_status: "done", updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);

    return new Response(JSON.stringify({ ok: true, page_id: body.page_id, rows: rows.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
