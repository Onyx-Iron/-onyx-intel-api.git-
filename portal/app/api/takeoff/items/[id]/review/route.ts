import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { recordTakeoffHistory } from "@/lib/takeoff/history";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { logEvent } from "@/lib/activity";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * PATCH /api/takeoff/items/[id]/review { action: "review" | "approve" | "reject", reason? }
 *
 * The human-control gate for AI-vision-sourced takeoff items.
 * - "review" flips review_status to "reviewed" — an estimator has looked at
 *   it, but this is NOT approval; the item is still excluded from the
 *   estimate exactly like "suggested".
 * - "approve" flips it to "approved" and immediately re-syncs the project's
 *   estimate (the item was excluded from every prior sync until now).
 * - "reject" flips it to "rejected" — the row stays in takeoff_items,
 *   permanently auditable, but buildEstimateImportRows excludes it forever;
 *   it can never flow into an estimate unless a human later approves it.
 *
 * Approval requires the "financial" write permission (the same gate used
 * for procurement/PO approval and the estimate matrix) — an authenticated
 * session alone is not sufficient; the caller's role must be permitted to
 * affect estimate totals. The client's request body has no way to bypass
 * this: `id` is a path param scoped server-side by tenantId (derived from
 * the Clerk session, never trusted from the request body), and the review
 * decision is a fixed enum, not a client-supplied status string.
 *
 * Scope note (P-06 from the milestone-1 validation pass): this check is
 * TENANT-wide, not project-scoped — any user with financial-write role in
 * the tenant can approve/reject any takeoff item in that tenant, regardless
 * of which project it belongs to. This is a deliberate match to how every
 * other "financial" resource in the app works today (procurement/PO
 * approval, the estimate matrix) — there is no existing per-project
 * membership system anywhere in the codebase to extend instead (project
 * access itself is tenant-wide; see AUTHORIZATION_AUDIT.md). Introducing
 * project-level approval authority would mean inventing a new
 * authorization dimension used nowhere else in the app, which is out of
 * scope for this route alone. If project-scoped approval is genuinely
 * required, it should be designed once, application-wide, not bolted onto
 * this one endpoint.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string };
    if (body.action !== "review" && body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json({ error: "action must be 'review', 'approve', or 'reject'" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    try {
      await assertPermission(tenantId, userId, "financial", "write");
    } catch (e) {
      if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
      throw e;
    }

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: before, error: beforeErr } = await anyDb
      .from("takeoff_items")
      .select("*")
      .eq("id", id).eq("tenant_id", tenantId)
      .maybeSingle();
    if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });
    if (!before) return NextResponse.json({ error: "Takeoff item not found" }, { status: 404 });

    const reviewStatus = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "reviewed";
    const patch: Record<string, unknown> = {
      review_status: reviewStatus,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (body.action === "approve") { patch.approved_by = userId; patch.approved_at = new Date().toISOString(); }
    if (body.action === "reject") patch.rejected_reason = body.reason?.slice(0, 500) ?? null;

    const { data: updated, error } = await anyDb
      .from("takeoff_items")
      .update(patch)
      .eq("id", id).eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    // "reviewed" isn't its own history action (the table's action CHECK is
    // created/updated/deleted/approved/rejected) — recorded as "updated"
    // instead; the before/after snapshot still shows review_status
    // transitioning to "reviewed", so it's fully auditable either way.
    const historyAction = reviewStatus === "approved" ? "approved" as const
      : reviewStatus === "rejected" ? "rejected" as const
      : "updated" as const;
    await recordTakeoffHistory(anyDb, {
      tenantId, projectId: before.project_id ?? null, takeoffItemId: id,
      action: historyAction,
      actorUserId: userId, before, after: updated,
    });

    void logEvent({
      projectId: before.project_id ?? "",
      tenantId, userId,
      entityType: "takeoff",
      entityId: id,
      action: "updated",
      title: `Takeoff item ${reviewStatus}: ${before.label ?? id}`,
      meta: { review_status: reviewStatus },
    });

    // Only approving can add anything new to the estimate — rejected items
    // are excluded by buildEstimateImportRows, so no sync needed for that path.
    const sync = reviewStatus === "approved" && before.project_id
      ? await syncTakeoffToEstimate(tenantId, before.project_id)
      : null;

    return NextResponse.json({ item: updated, estimate_synced: sync });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[PATCH /api/takeoff/items/[id]/review] ${msg}` }, { status: 500 });
  }
}
