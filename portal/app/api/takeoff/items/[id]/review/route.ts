import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { recordTakeoffHistory } from "@/lib/takeoff/history";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

/**
 * PATCH /api/takeoff/items/[id]/review { action: "approve" | "reject", reason? }
 *
 * The human-control gate for AI-vision-sourced takeoff items. Approving
 * flips review_status to "approved" and immediately re-syncs the project's
 * estimate (the item was excluded from every prior sync while pending).
 * Rejecting flips it to "rejected" — the row stays in takeoff_items,
 * permanently auditable, but buildEstimateImportRows excludes it forever;
 * it can never flow into an estimate unless a human later approves it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string };
    if (body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
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

    const reviewStatus = body.action === "approve" ? "approved" : "rejected";
    const patch: Record<string, unknown> = {
      review_status: reviewStatus,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (body.action === "reject") patch.rejected_reason = body.reason?.slice(0, 500) ?? null;

    const { data: updated, error } = await anyDb
      .from("takeoff_items")
      .update(patch)
      .eq("id", id).eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    await recordTakeoffHistory(anyDb, {
      tenantId, projectId: before.project_id ?? null, takeoffItemId: id,
      action: reviewStatus === "approved" ? "approved" : "rejected",
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
