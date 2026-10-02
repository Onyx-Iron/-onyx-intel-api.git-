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
import {
  allocateDirectCosts,
  blocksEstimateImport,
  pricingStatus,
  takeoffSyncFingerprint,
} from "../_shared/estimate-sync-contract.ts";

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

// Pricing, review gate, and fingerprint live in _shared/estimate-sync-contract.ts
// so this worker and portal/lib/estimating/auto-sync.ts cannot drift.

/** Minimal port of portal getOrCreateDraftVersion — never writes to a locked version. */
// deno-lint-ignore no-explicit-any
async function getOrCreateDraftVersion(db: any, tenantId: string, projectId: string): Promise<string | null> {
  const { data: estimate } = await db
    .from("estimates")
    .select("id, current_version_id")
    .eq("tenant_id", tenantId).eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!estimate) {
    const { data: newEstimate, error } = await db
      .from("estimates")
      .insert({
        tenant_id: tenantId, project_id: projectId,
        estimate_number: `EST-${crypto.randomUUID().slice(0, 8)}`,
        name: "Estimate", status: "draft",
      })
      .select("id").single();
    if (error || !newEstimate) {
      console.error("[page-takeoff-worker] create estimate failed", error);
      return null;
    }
    const { data: version, error: vErr } = await db
      .from("estimate_versions")
      .insert({ estimate_id: newEstimate.id, version_number: 1, version_name: "Version 1", status: "draft" })
      .select("id").single();
    if (vErr || !version) {
      console.error("[page-takeoff-worker] create version failed", vErr);
      return null;
    }
    await db.from("estimates").update({ current_version_id: version.id }).eq("id", newEstimate.id);
    return version.id as string;
  }

  if (estimate.current_version_id) {
    const { data: current } = await db
      .from("estimate_versions")
      .select("id, status, version_number")
      .eq("id", estimate.current_version_id)
      .single();
    if (current && (current.status === "draft" || current.status === "review")) {
      return current.id as string;
    }
    // Locked — open a new draft seeded from the locked version's items.
    const nextNum = (current?.version_number ?? 0) + 1;
    const { data: newDraft, error: dErr } = await db
      .from("estimate_versions")
      .insert({
        estimate_id: estimate.id,
        version_number: nextNum,
        version_name: `Version ${nextNum}`,
        status: "draft",
        notes: "Auto-created because the current version was locked.",
      })
      .select("id").single();
    if (dErr || !newDraft) {
      console.error("[page-takeoff-worker] create draft failed", dErr);
      return null;
    }
    if (current?.id) {
      const { data: sourceItems } = await db
        .from("estimate_items")
        .select("description,csi_code,cost_code,trade,item_type,quantity,uom,unit_cost,labor_cost,material_cost,equipment_cost,total_direct_cost,contingency,overhead,profit,total_price,unit_price,pricing_status,notes,source_takeoff_id,source_fingerprint,quantity_basis,drawing_ref,location_tag")
        .eq("estimate_version_id", current.id);
      if (sourceItems && sourceItems.length > 0) {
        await db.from("estimate_items").insert(
          sourceItems.map((it: Record<string, unknown>) => ({
            ...it,
            tenant_id: tenantId,
            project_id: projectId,
            estimate_version_id: newDraft.id,
            created_by: "system_takeoff_sync",
            updated_by: "system_takeoff_sync",
          })),
        );
      }
    }
    await db.from("estimates").update({ current_version_id: newDraft.id }).eq("id", estimate.id);
    return newDraft.id as string;
  }

  const { data: version, error: vErr } = await db
    .from("estimate_versions")
    .insert({ estimate_id: estimate.id, version_number: 1, version_name: "Version 1", status: "draft" })
    .select("id").single();
  if (vErr || !version) {
    console.error("[page-takeoff-worker] create version failed", vErr);
    return null;
  }
  await db.from("estimates").update({ current_version_id: version.id }).eq("id", estimate.id);
  return version.id as string;
}

// deno-lint-ignore no-explicit-any
async function syncTakeoffToEstimate(db: any, tenantId: string, projectId: string): Promise<void> {
  const versionId = await getOrCreateDraftVersion(db, tenantId, projectId);
  if (!versionId) return;

  const { data: versionMeta } = await db
    .from("estimate_versions")
    .select("estimate_id")
    .eq("id", versionId)
    .single();
  const { data: versionIds } = versionMeta?.estimate_id
    ? await db.from("estimate_versions").select("id").eq("estimate_id", versionMeta.estimate_id)
    : { data: [{ id: versionId }] };

  const estimateVersionIds = ((versionIds ?? []) as Array<{ id: string }>).map((v) => v.id);
  if (estimateVersionIds.length === 0) estimateVersionIds.push(versionId);

  const [takeoff, existing, catalog] = await Promise.all([
    // SQL-filter non-approved rows — same gate as takeoff-import.ts.
    db.from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta,review_status")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .or("review_status.is.null,review_status.eq.approved"),
    db.from("estimate_items")
      .select("source_takeoff_id,source_fingerprint")
      .in("estimate_version_id", estimateVersionIds),
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
  const distinctCodes = [...new Set((takeoff.data ?? []).map((t: any) => t.csi_code).filter(Boolean))] as string[];
  if (distinctCodes.length > 0) {
    const { data: codeRows } = await db.from("cost_codes").select("id,csi_code").in("csi_code", distinctCodes);
    const codeIdByCsi = new Map<string, string>((codeRows ?? []).map((r: { id: string; csi_code: string }) => [r.csi_code, r.id]));
    const codeIds = [...codeIdByCsi.values()];
    if (codeIds.length > 0) {
      const [overridesRes, nationalRes] = await Promise.all([
        db.from("cost_overrides").select("cost_code_id,unit_cost,effective_from").eq("tenant_id", tenantId).in("cost_code_id", codeIds).order("effective_from", { ascending: false }),
        db.from("cost_prices").select("cost_code_id,unit_cost").in("cost_code_id", codeIds).eq("region_type", "national").order("observed_at", { ascending: false }),
      ]);
      const overrideByCodeId = new Map<string, number>();
      for (const r of overridesRes.data ?? []) {
        if (!overrideByCodeId.has(r.cost_code_id) && r.unit_cost != null) overrideByCodeId.set(r.cost_code_id, Number(r.unit_cost));
      }
      const nationalByCodeId = new Map<string, number>();
      for (const r of nationalRes.data ?? []) {
        if (!nationalByCodeId.has(r.cost_code_id) && r.unit_cost != null) nationalByCodeId.set(r.cost_code_id, Number(r.unit_cost));
      }
      for (const [csi, codeId] of codeIdByCsi) {
        const cost = overrideByCodeId.get(codeId) ?? nationalByCodeId.get(codeId);
        if (cost != null && cost > 0) costLookup.set(`${csi}|*`, cost);
      }
    }
  }

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
    // Hard gate: only 'approved' items reach the estimate (mirrors
    // lib/estimating/takeoff-import.ts's identical check). 'suggested' and
    // 'reviewed' are both still unapproved; 'rejected' is permanent.
    if (blocksEstimateImport(t.review_status)) continue;

    const meta = (t.meta ?? {}) as Record<string, unknown>;
    const drawingRef = typeof meta.drawing_ref === "string" ? meta.drawing_ref : null;
    const locationTag = typeof meta.location_tag === "string" ? meta.location_tag : null;
    const fp = takeoffSyncFingerprint({
      label: t.label,
      csi_code: t.csi_code,
      quantity: t.quantity,
      unit: t.unit,
      meta: { drawing_ref: drawingRef, location_tag: locationTag },
    });
    if (existingKeys.has(`id:${t.id}`) || existingKeys.has(`fp:${fp}`)) continue;
    existingKeys.add(`fp:${fp}`);

    const uom = (t.unit ?? "").toUpperCase() || null;
    const unitCost = t.csi_code
      ? costLookup.get(`${t.csi_code}|${uom}`) ?? costLookup.get(`${t.csi_code}|*`) ?? null
      : null;
    const aiVision = meta.extraction_method === "ai_vision";
    const allocated = allocateDirectCosts(t.quantity ?? 0, unitCost, null);
    const totalDirect =
      allocated.laborCost + allocated.materialCost + allocated.equipmentCost;

    rows.push({
      tenant_id: tenantId,
      project_id: projectId,
      estimate_version_id: versionId,
      description: t.label ?? "Takeoff item",
      csi_code: t.csi_code ?? null,
      cost_code: t.csi_code ?? null,
      trade: typeof meta.trade === "string" ? meta.trade : null,
      item_type: "material",
      quantity: t.quantity ?? null,
      uom,
      unit_cost: unitCost,
      labor_cost: allocated.laborCost,
      material_cost: allocated.materialCost,
      equipment_cost: allocated.equipmentCost,
      total_direct_cost: totalDirect,
      total_price: totalDirect,
      unit_price: unitCost,
      source_takeoff_id: t.id,
      source_fingerprint: fp,
      quantity_basis: typeof meta.quantity_basis === "string" ? meta.quantity_basis : null,
      drawing_ref: drawingRef,
      location_tag: locationTag,
      pricing_status: pricingStatus(aiVision, unitCost),
      notes: [
        aiVision ? "Review required: AI vision quantity" : null,
        drawingRef ? `Source: ${drawingRef}` : null,
      ].filter(Boolean).join(" | ") || "Source: takeoff import",
      created_by: "system_takeoff_sync",
      updated_by: "system_takeoff_sync",
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
        sheet_id: body.page_id,
        // Deterministic rows (PDF table/DXF/IFC/XLSX math) are grounded in
        // real source data and implicitly approved; ai_vision rows are an
        // unverified suggestion and must wait for a human review action
        // before they can reach the estimate (see syncTakeoffToEstimate
        // below, which excludes non-approved rows).
        created_by: null,
        review_status: r.extraction_method === "ai_vision" ? "suggested" : "approved",
        source_method: r.extraction_method ?? "deterministic",
        confidence_score: r.confidence ?? null,
        meta: {
          trade: r.trade ?? null,
          quantity_basis: r.quantity_basis ?? null,
          drawing_ref: r.drawing_ref ?? null,
          location_tag: r.location_tag ?? null,
          extraction_method: r.extraction_method ?? "deterministic",
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
    await recordEvent("succeeded");
    await refreshDocumentSummary();

    return new Response(JSON.stringify({ ok: true, page_id: body.page_id, rows: rows.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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
