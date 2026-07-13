import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processOutboxBatch } from "@/lib/estimating/outbox-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-to-server outbox worker trigger (manual-takeoff-productivity
 * milestone, STEP 14). NOT a user-facing route — authenticated by a shared
 * secret (INTERNAL_WORKER_SECRET), not Clerk. Intended callers:
 *
 *   1. A pg_cron + pg_net job (see OUTBOX_WORKER.md for the one-time setup
 *      this requires — a deployed URL + a Supabase Vault secret, following
 *      the same pattern already established by
 *      20260707_schedule_commodity_sync.sql).
 *   2. Opportunistically, right after every manual-takeoff save/update/
 *      delete (see app/api/takeoff/canvas/manual/route.ts) — this is what
 *      makes retry actually happen today even before a cron job is wired
 *      up to a real deployed URL.
 *
 * POST { batch_size?: number }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "INTERNAL_WORKER_SECRET is not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-worker-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { batch_size?: number };
  const batchSize = typeof body.batch_size === "number" && body.batch_size > 0 && body.batch_size <= 100 ? body.batch_size : 20;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  try {
    const result = await processOutboxBatch(anyDb, `http-worker-${Date.now()}`, batchSize);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
