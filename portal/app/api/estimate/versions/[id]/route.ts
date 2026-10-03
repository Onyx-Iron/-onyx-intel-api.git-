import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { assertVersionEditable, getServiceDb, loadVersionForTenant, NotFoundError, VersionLockedError } from "@/lib/estimating/versioning";
import { applyVersionPercentages, calculateEstimateTotals, calculateItem, priceItemAtVersionPercentages } from "@/lib/estimating/calculations";
import { recordEstimateAudit, recordEstimateAuditBatch } from "@/lib/estimating/audit";

export const runtime = "nodejs";

interface ItemPatch {
  id?: string;
  cost_code?: string | null;
  description?: string;
  scope_category?: string | null;
  quantity?: number | null;
  uom?: string | null;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  trucking_cost?: number;
  subcontract_cost?: number;
  disposal_cost?: number;
  testing_cost?: number;
  other_direct_cost?: number;
  indirect_cost?: number;
  contingency?: number;
  overhead?: number;
  profit?: number;
  notes?: string | null;
  assumptions?: string | null;
  exclusions?: string | null;
  is_allowance?: boolean;
  is_alternate?: boolean;
  alternate_accepted?: boolean;
  item_type?: string | null;
  csi_code?: string | null;
}

/**
 * GET   -> { version, items, totals } — totals are ALWAYS server-recalculated
 *          from the items' cost-category fields, never read from a stored
 *          "total" column trusted at face value (STEP 3: never trust a
 *          browser-supplied total; here that extends to never trust a
 *          stale stored total either — every read recomputes).
 * PATCH { items: [...] } -> bulk upsert items into this version. 409s if the
 *          version isn't a draft/review (STEP 2: approved/superseded/void
 *          are immutable through normal edit routes — this is the
 *          application-layer half of that guarantee; the DB trigger is the
 *          other half).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await getServiceDb();

  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  const { data: items, error } = await db
    .from("estimate_items")
    .select("*")
    .eq("estimate_version_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = calculateEstimateTotals(
    (items ?? []).map((it: Record<string, unknown>) => ({
      totalDirectCost: it.total_direct_cost as number,
      indirectCost: it.indirect_cost as number,
      contingency: it.contingency as number,
      overhead: it.overhead as number,
      profit: it.profit as number,
      totalPrice: it.total_price as number,
      isAlternate: it.is_alternate as boolean,
      alternateAccepted: it.alternate_accepted as boolean,
    })),
  );

  return NextResponse.json({ version, items: items ?? [], totals });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as {
    items?: ItemPatch[];
    settings?: { contingency_pct?: number; overhead_pct?: number; profit_pct?: number };
  };
  if (!Array.isArray(body.items) && !body.settings) {
    return NextResponse.json({ error: "items array or settings required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  try {
    assertVersionEditable(version.status);
  } catch (e) {
    if (e instanceof VersionLockedError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Version-level percentage settings (the "sliders") update the version
  // row directly — draft-only, same lock as items. This is the internal
  // day-to-day editing path; the separate buyer-adjustment endpoint is for
  // the distinct "show original/proposed/reason, require confirmation"
  // workflow (STEP 7), not every routine slider tweak.
  let effectiveVersion = version;
  const settingsPatch: Record<string, number> = {};
  if (body.settings) {
    if (typeof body.settings.contingency_pct === "number") settingsPatch.contingency_pct = body.settings.contingency_pct;
    if (typeof body.settings.overhead_pct === "number") settingsPatch.overhead_pct = body.settings.overhead_pct;
    if (typeof body.settings.profit_pct === "number") settingsPatch.profit_pct = body.settings.profit_pct;
    if (Object.keys(settingsPatch).length > 0) {
      const { data: updatedVersion, error: vErr } = await db
        .from("estimate_versions").update(settingsPatch).eq("id", id).select("*").single();
      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
      effectiveVersion = { ...effectiveVersion, ...updatedVersion };
    }
  }

  const percentages = {
    contingencyPct: effectiveVersion.contingency_pct ?? 0,
    overheadPct: effectiveVersion.overhead_pct ?? 0,
    profitPct: effectiveVersion.profit_pct ?? 0,
  };
  const settingsChanged =
    (settingsPatch.contingency_pct !== undefined && settingsPatch.contingency_pct !== (version.contingency_pct ?? 0)) ||
    (settingsPatch.overhead_pct !== undefined && settingsPatch.overhead_pct !== (version.overhead_pct ?? 0)) ||
    (settingsPatch.profit_pct !== undefined && settingsPatch.profit_pct !== (version.profit_pct ?? 0));

  // A slider change used to update only the version row. The on-screen bid
  // recomputes from those percentages, but Excel, PDF, and CSV read each
  // line's stored total. Reprice every line that this request does not
  // already upsert so the downloaded sell price includes the new markup.
  if (settingsChanged) {
    const incomingIds = new Set(
      (body.items ?? []).map((item) => item.id).filter((itemId): itemId is string => typeof itemId === "string" && itemId.length > 0),
    );
    const { data: existingForReprice, error: repriceFetchErr } = await db
      .from("estimate_items")
      .select("id, quantity, labor_cost, material_cost, equipment_cost, trucking_cost, subcontract_cost, disposal_cost, testing_cost, other_direct_cost, indirect_cost, pricing_status, notes")
      .eq("estimate_version_id", id)
      .eq("tenant_id", tenantId);
    if (repriceFetchErr) return NextResponse.json({ error: repriceFetchErr.message }, { status: 500 });

    const stale = ((existingForReprice ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        if (incomingIds.has(String(row.id))) return false;
        // Unpriced, review, and source-removed lines stay out of the sell
        // price. Repricing them would push markup into proposal totals the
        // bid screen does not include.
        const notes = typeof row.notes === "string" ? row.notes : "";
        if (notes.startsWith("Source removed")) return false;
        if (row.pricing_status === "unpriced" || row.pricing_status === "review") return false;
        return true;
      });
    const REPRICE_BATCH = 8;
    for (let i = 0; i < stale.length; i += REPRICE_BATCH) {
      const batch = stale.slice(i, i + REPRICE_BATCH);
      const results = await Promise.all(batch.map(async (row) => {
        const priced = priceItemAtVersionPercentages({
          quantity: row.quantity as number | null,
          laborCost: row.labor_cost as number | null,
          materialCost: row.material_cost as number | null,
          equipmentCost: row.equipment_cost as number | null,
          truckingCost: row.trucking_cost as number | null,
          subcontractCost: row.subcontract_cost as number | null,
          disposalCost: row.disposal_cost as number | null,
          testingCost: row.testing_cost as number | null,
          otherDirectCost: row.other_direct_cost as number | null,
          indirectCost: row.indirect_cost as number | null,
        }, percentages);
        const { error } = await db.from("estimate_items").update({
          total_direct_cost: priced.totalDirectCost,
          contingency: priced.contingency,
          overhead: priced.overhead,
          profit: priced.profit,
          total_price: priced.totalPrice,
          unit_price: priced.unitPrice,
          updated_by: userId,
        }).eq("id", row.id).eq("estimate_version_id", id).eq("tenant_id", tenantId);
        return error;
      }));
      const failed = results.find((error) => error);
      if (failed) return NextResponse.json({ error: failed.message }, { status: 500 });
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    const totals = await getVersionTotals(db, id);
    return NextResponse.json({ items: [], totals, version: effectiveVersion });
  }

  const { data: existingRows } = await db
    .from("estimate_items")
    .select("*")
    .eq("estimate_version_id", id);
  const existingById = new Map((existingRows ?? []).map((row: { id: string }) => [row.id, row]));

  const pct = percentages;

  // Server-side recalculation of every item — the client may send whatever
  // it wants in total_price/unit_price, and it is IGNORED; only the
  // cost-category inputs are trusted, and calculateItem derives everything
  // else. This is the concrete enforcement of "do not trust totals
  // supplied by the browser." indirect/contingency/overhead/profit are
  // taken from the item patch when explicitly supplied (item-level
  // override); otherwise auto-derived from the version's percentages, so a
  // caller (like the pricing-matrix UI) only needs to send raw cost-category
  // dollar amounts and the server applies the same cascade the version's
  // sliders represent.
  const payload = body.items.map((item) => {
    const totalDirectCostPreview = [
      item.labor_cost, item.material_cost, item.equipment_cost, item.trucking_cost,
      item.subcontract_cost, item.disposal_cost, item.testing_cost, item.other_direct_cost,
    ].reduce((s: number, v) => s + (typeof v === "number" ? v : 0), 0);
    const indirectCost = item.indirect_cost ?? 0;
    const hasExplicitPctFields = item.contingency != null || item.overhead != null || item.profit != null;
    const derived = hasExplicitPctFields
      ? { contingency: item.contingency ?? 0, overhead: item.overhead ?? 0, profit: item.profit ?? 0 }
      : applyVersionPercentages(totalDirectCostPreview, indirectCost, pct);

    const calc = calculateItem({
      laborCost: item.labor_cost, materialCost: item.material_cost, equipmentCost: item.equipment_cost,
      truckingCost: item.trucking_cost, subcontractCost: item.subcontract_cost, disposalCost: item.disposal_cost,
      testingCost: item.testing_cost, otherDirectCost: item.other_direct_cost,
      quantity: item.quantity, indirectCost,
      contingency: derived.contingency, overhead: derived.overhead, profit: derived.profit,
    });
    const isUpdate = item.id != null && existingById.has(item.id);
    return {
      id: item.id ?? crypto.randomUUID(),
      tenant_id: tenantId,
      project_id: version.project_id,
      estimate_version_id: id,
      cost_code: item.cost_code ?? null,
      csi_code: item.csi_code ?? item.cost_code ?? null,
      item_type: item.item_type ?? "material",
      description: item.description ?? "Untitled item",
      scope_category: item.scope_category ?? null,
      quantity: item.quantity ?? null,
      uom: item.uom ?? null,
      labor_cost: item.labor_cost ?? 0,
      material_cost: item.material_cost ?? 0,
      equipment_cost: item.equipment_cost ?? 0,
      trucking_cost: item.trucking_cost ?? 0,
      subcontract_cost: item.subcontract_cost ?? 0,
      disposal_cost: item.disposal_cost ?? 0,
      testing_cost: item.testing_cost ?? 0,
      other_direct_cost: item.other_direct_cost ?? 0,
      total_direct_cost: calc.totalDirectCost,
      indirect_cost: indirectCost,
      contingency: derived.contingency,
      overhead: derived.overhead,
      profit: derived.profit,
      total_price: calc.totalPrice,
      unit_price: calc.unitPrice,
      notes: item.notes ?? null,
      assumptions: item.assumptions ?? null,
      exclusions: item.exclusions ?? null,
      is_allowance: item.is_allowance ?? false,
      is_alternate: item.is_alternate ?? false,
      alternate_accepted: item.alternate_accepted ?? false,
      updated_by: userId,
      pricing_status: "manual",
      ...(isUpdate ? {} : { created_by: userId }),
    };
  });

  const { data, error } = await db.from("estimate_items").upsert(payload, { onConflict: "id" }).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  await recordEstimateAuditBatch(db, (data ?? []).map((row: { id: string }) => {
    const before = existingById.get(row.id);
    return {
      tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
      entityType: "item" as const, entityId: row.id,
      action: (before ? "updated" : "created") as "updated" | "created",
      actorUserId: userId, before: before ?? null, after: row,
    };
  }));

  const totals = calculateEstimateTotals(
    (data ?? []).map((it: Record<string, unknown>) => ({
      totalDirectCost: it.total_direct_cost as number,
      indirectCost: it.indirect_cost as number,
      contingency: it.contingency as number,
      overhead: it.overhead as number,
      profit: it.profit as number,
      totalPrice: it.total_price as number,
      isAlternate: it.is_alternate as boolean,
      alternateAccepted: it.alternate_accepted as boolean,
    })),
  );

  return NextResponse.json({ items: data ?? [], totals, version: effectiveVersion });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getVersionTotals(db: any, versionId: string) {
  const { data: items } = await db
    .from("estimate_items")
    .select("total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, is_alternate, alternate_accepted")
    .eq("estimate_version_id", versionId);
  return calculateEstimateTotals(
    (items ?? []).map((it: Record<string, unknown>) => ({
      totalDirectCost: it.total_direct_cost as number,
      indirectCost: it.indirect_cost as number,
      contingency: it.contingency as number,
      overhead: it.overhead as number,
      profit: it.profit as number,
      totalPrice: it.total_price as number,
      isAlternate: it.is_alternate as boolean,
      alternateAccepted: it.alternate_accepted as boolean,
    })),
  );
}

/**
 * DELETE ?item_id= — deletes one item from this version. 409s if the
 * version is locked (same rule as PATCH; the DB trigger also enforces this
 * independently as a hard backstop).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const itemId = req.nextUrl.searchParams.get("item_id");
  if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
  try {
    assertVersionEditable(version.status);
  } catch (e) {
    if (e instanceof VersionLockedError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { data: before } = await db
    .from("estimate_items").select("*").eq("id", itemId).eq("estimate_version_id", id).maybeSingle();

  const { error } = await db.from("estimate_items").delete().eq("id", itemId).eq("estimate_version_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "item", entityId: itemId, action: "deleted", actorUserId: userId, before: before ?? null,
  });

  return NextResponse.json({ ok: true });
}
