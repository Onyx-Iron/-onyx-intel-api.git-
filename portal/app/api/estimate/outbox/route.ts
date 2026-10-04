import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { ownershipDenied, requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

type OutboxRow = {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  manual_takeoff_id: string | null;
  next_attempt_at: string | null;
  claimed_at: string | null;
  processed_at: string | null;
  created_at: string;
  payload: unknown;
};

/**
 * Project-scoped estimate-sync outbox list + health summary.
 *
 * GET ?project_id= → {
 *   events: OutboxRow[],
 *   health: { counts, dead_letter, stale_pending, last_processed_at, alerts[] }
 * }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id")?.trim();
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 40;

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "financial", "read");
  if (denied) return denied;

  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch (err) {
    const mapped = ownershipDenied(err);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data, error } = await anyDb
    .from("estimate_sync_outbox")
    .select(
      "id, event_type, status, attempts, last_error, manual_takeoff_id, next_attempt_at, claimed_at, processed_at, created_at, payload",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (data ?? []) as OutboxRow[];

  // Broader status counts (not limited to the page of events).
  const { data: statusRows, error: statusErr } = await anyDb
    .from("estimate_sync_outbox")
    .select("status, created_at, next_attempt_at, processed_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);

  if (statusErr) {
    return NextResponse.json({ error: statusErr.message }, { status: 500 });
  }

  const rows = (statusRows ?? []) as Array<{
    status: string;
    created_at: string;
    next_attempt_at: string | null;
    processed_at: string | null;
  }>;

  const counts: Record<string, number> = {
    pending: 0,
    processing: 0,
    processed: 0,
    failed: 0,
    dead_letter: 0,
  };
  let lastProcessedAt: string | null = null;
  const now = Date.now();
  const STALE_MS = 15 * 60 * 1000;
  let stalePending = 0;

  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (row.processed_at) {
      if (!lastProcessedAt || row.processed_at > lastProcessedAt) {
        lastProcessedAt = row.processed_at;
      }
    }
    if (row.status === "pending" || row.status === "failed") {
      const due = row.next_attempt_at ? new Date(row.next_attempt_at).getTime() : new Date(row.created_at).getTime();
      if (Number.isFinite(due) && now - due > STALE_MS) stalePending += 1;
    }
    if (row.status === "processing" && row.created_at) {
      const age = now - new Date(row.created_at).getTime();
      if (age > STALE_MS) stalePending += 1;
    }
  }

  const alerts: string[] = [];
  if ((counts.dead_letter ?? 0) > 0) {
    alerts.push(`${counts.dead_letter} dead-letter event${counts.dead_letter === 1 ? "" : "s"} need manual retry`);
  }
  if (stalePending > 0) {
    alerts.push(`${stalePending} sync event${stalePending === 1 ? "" : "s"} stuck >15m`);
  }
  if ((counts.failed ?? 0) > 0 && (counts.dead_letter ?? 0) === 0) {
    alerts.push(`${counts.failed} failed event${counts.failed === 1 ? "" : "s"} awaiting backoff retry`);
  }

  return NextResponse.json({
    events,
    health: {
      counts,
      dead_letter: counts.dead_letter ?? 0,
      stale_pending: stalePending,
      last_processed_at: lastProcessedAt,
      alerts,
      healthy: alerts.length === 0,
    },
  });
}
