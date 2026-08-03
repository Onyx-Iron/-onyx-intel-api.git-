// Estimate versioning helpers — server-side only. These wrap the
// estimates/estimate_versions/estimate_items tables and are the single
// place that decides whether a version may be written to, so no API route
// can accidentally bypass the "approved versions are immutable" rule by
// reimplementing the check slightly differently.
import { createServiceClient } from "@/lib/supabase/server";
import { calculateEstimateTotals } from "./calculations";

export type VersionStatus = "draft" | "review" | "approved" | "superseded" | "void";

export class VersionLockedError extends Error {
  status = 409;
  constructor(status: VersionStatus) {
    super(`This estimate version is '${status}' and cannot be edited directly. Create a new draft to make changes.`);
    this.name = "VersionLockedError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface EstimateVersionRow {
  id: string;
  estimate_id: string;
  project_id: string;
  tenant_id: string;
  version_number: number;
  version_name: string | null;
  status: VersionStatus;
  contingency_pct: number | null;
  overhead_pct: number | null;
  profit_pct: number | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  superseded_by: string | null;
  notes: string | null;
}

/** Verifies a version belongs to the given tenant (via its parent estimate) before any read/write touches it. */
export async function loadVersionForTenant(db: AnyDb, versionId: string, tenantId: string): Promise<EstimateVersionRow> {
  const { data, error } = await db
    .from("estimate_versions")
    .select("*, estimates!estimate_versions_estimate_id_fkey!inner(tenant_id, project_id, id)")
    .eq("id", versionId)
    .eq("estimates.tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Estimate version not found for this tenant.");
  // Flatten the joined estimate fields so callers get a single object with
  // project_id/tenant_id directly on it, rather than needing to know
  // whether Supabase nested the join as `estimates.project_id`.
  const { estimates, ...version } = data as Record<string, unknown> & { estimates: { tenant_id: string; project_id: string } };
  return { ...version, tenant_id: estimates.tenant_id, project_id: estimates.project_id } as EstimateVersionRow;
}

/** Throws VersionLockedError if the version's status forbids direct item writes. */
export function assertVersionEditable(status: VersionStatus): void {
  if (status === "approved" || status === "superseded" || status === "void") {
    throw new VersionLockedError(status);
  }
}

/**
 * Creates a new draft version by copying every item from a source version
 * (typically the current approved one). Used both for "edits to an approved
 * estimate must create a new draft version" (STEP 2) and for "restore as
 * new draft" (STEP 8).
 */
export async function createDraftFromVersion(
  db: AnyDb,
  params: { estimateId: string; sourceVersionId: string | null; userId: string; versionName?: string; notes?: string },
): Promise<EstimateVersionRow> {
  let sourcePct: { contingency_pct: number | null; overhead_pct: number | null; profit_pct: number | null } = {
    contingency_pct: null, overhead_pct: null, profit_pct: null,
  };
  if (params.sourceVersionId) {
    const { data: source } = await db
      .from("estimate_versions")
      .select("contingency_pct, overhead_pct, profit_pct")
      .eq("id", params.sourceVersionId)
      .maybeSingle();
    if (source) sourcePct = source;
  }

  // version_number is picked by reading the current max and adding one —
  // not itself atomic, so two concurrent callers (e.g. two overlapping
  // takeoff syncs both finding the current version locked) can race and
  // compute the same nextNumber. The `unique(estimate_id, version_number)`
  // constraint (migration) then makes the loser's insert fail with a
  // unique-violation (Postgres 23505) rather than silently duplicate a
  // version — retried here up to 3 times with a fresh version_number read
  // each time, so the race resolves into two distinct version numbers
  // instead of surfacing as an unhandled 500 to the caller.
  let newVersion: EstimateVersionRow | null = null;
  let lastError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 3 && !newVersion; attempt++) {
    const { data: maxRow } = await db
      .from("estimate_versions")
      .select("version_number")
      .eq("estimate_id", params.estimateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = (maxRow?.version_number ?? 0) + 1;

    const { data, error: createError } = await db
      .from("estimate_versions")
      .insert({
        estimate_id: params.estimateId,
        version_number: nextNumber,
        version_name: params.versionName ?? `Version ${nextNumber}`,
        status: "draft",
        created_by: params.userId,
        notes: params.notes ?? null,
        contingency_pct: sourcePct.contingency_pct,
        overhead_pct: sourcePct.overhead_pct,
        profit_pct: sourcePct.profit_pct,
      })
      .select("*")
      .single();

    if (!createError) { newVersion = data as EstimateVersionRow; break; }
    lastError = createError;
    if (createError.code !== "23505") throw createError; // any error other than the expected race is real — don't retry it away
  }
  if (!newVersion) throw new Error(lastError?.message ?? "Failed to create a new estimate version after retrying a version_number conflict.");

  if (params.sourceVersionId) {
    const { data: sourceItems, error: itemsError } = await db
      .from("estimate_items")
      .select("*")
      .eq("estimate_version_id", params.sourceVersionId);
    if (itemsError) throw itemsError;

    if (sourceItems && sourceItems.length > 0) {
      const copies = sourceItems.map((item: Record<string, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, created_at, updated_at, ...rest } = item;
        return { ...rest, estimate_version_id: newVersion.id, updated_by: params.userId };
      });
      const { error: copyError } = await db.from("estimate_items").insert(copies);
      if (copyError) throw copyError;
    }
  }

  return newVersion as EstimateVersionRow;
}

/**
 * Approves a version: marks it approved, supersedes whatever the estimate's
 * previous current_version_id was (if any and if it was itself an approved
 * version — draft/review predecessors are simply left behind, not marked
 * superseded, since "superseded" specifically means "was once the approved
 * one"), and updates the estimate header's current_version_id.
 */
export async function approveVersion(
  db: AnyDb,
  params: { versionId: string; estimateId: string; userId: string },
): Promise<EstimateVersionRow> {
  const { data: estimate, error: estError } = await db
    .from("estimates")
    .select("current_version_id")
    .eq("id", params.estimateId)
    .single();
  if (estError) throw estError;

  const previousVersionId: string | null = estimate?.current_version_id ?? null;

  const { data: approved, error: approveError } = await db
    .from("estimate_versions")
    .update({ status: "approved", approved_by: params.userId, approved_at: new Date().toISOString() })
    .eq("id", params.versionId)
    .select("*")
    .single();
  if (approveError) throw approveError;

  if (previousVersionId && previousVersionId !== params.versionId) {
    const { data: previous } = await db
      .from("estimate_versions")
      .select("status")
      .eq("id", previousVersionId)
      .maybeSingle();
    if (previous?.status === "approved") {
      await db.from("estimate_versions")
        .update({ status: "superseded", superseded_by: params.versionId })
        .eq("id", previousVersionId);
    }
  }

  await db.from("estimates")
    .update({ current_version_id: params.versionId, updated_by: params.userId, updated_at: new Date().toISOString() })
    .eq("id", params.estimateId);

  return approved as EstimateVersionRow;
}

/** Recalculates and persists every item's derived totals for a version, then returns the version-level roll-up. Never trusts pre-computed totals passed from the browser — always re-derives from cost-category inputs. */
export async function recalculateVersionTotals(db: AnyDb, versionId: string) {
  const { data: items, error } = await db
    .from("estimate_items")
    .select("total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, is_alternate, alternate_accepted")
    .eq("estimate_version_id", versionId);
  if (error) throw error;
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

export async function getServiceDb(): Promise<AnyDb> {
  return (await createServiceClient()) as AnyDb;
}

/**
 * Resolves the project's one authoritative estimate + a writable (draft or
 * review) version, creating either as needed. If the current version is
 * locked (approved/superseded/void), opens a new draft seeded from it
 * rather than ever writing to the locked one. Shared by every write path
 * that needs "the draft to write into" — takeoff auto-sync, the pricing-
 * matrix seed action, and any future bulk-import route — so there is
 * exactly one implementation of "which version do I write to."
 */
export async function getOrCreateDraftVersion(
  db: AnyDb, tenantId: string, projectId: string, actorUserId = "system",
): Promise<{ estimateId: string; versionId: string }> {
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
    if (error) throw error;
    const { data: version, error: vErr } = await db
      .from("estimate_versions")
      .insert({ estimate_id: newEstimate.id, version_number: 1, version_name: "Version 1", status: "draft" })
      .select("id").single();
    if (vErr) throw vErr;
    await db.from("estimates").update({ current_version_id: version.id }).eq("id", newEstimate.id);
    return { estimateId: newEstimate.id, versionId: version.id };
  }

  if (!estimate.current_version_id) {
    const version = await createDraftFromVersion(db, { estimateId: estimate.id, sourceVersionId: null, userId: actorUserId });
    await db.from("estimates").update({ current_version_id: version.id }).eq("id", estimate.id);
    return { estimateId: estimate.id, versionId: version.id };
  }

  const { data: current } = await db
    .from("estimate_versions")
    .select("id, status")
    .eq("id", estimate.current_version_id)
    .single();

  if (current.status === "draft" || current.status === "review") {
    return { estimateId: estimate.id, versionId: current.id };
  }

  // Current version is approved/superseded/void — never write to it. Open a
  // new draft (seeded from it) instead.
  const newDraft = await createDraftFromVersion(db, {
    estimateId: estimate.id, sourceVersionId: current.id, userId: actorUserId,
    notes: "Auto-created because the current version was locked.",
  });
  return { estimateId: estimate.id, versionId: newDraft.id };
}
