import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeOutboxCron, authorizeOutboxPost } from "@/lib/estimating/outbox-cron-auth";
import { processOutboxBatch } from "@/lib/estimating/outbox-worker";

export const runtime = "nodejs";
// A batch of estimate syncs. The cron fires every 5 minutes, so this stays
// under that interval; claim_outbox_events reclaims anything a run drops.
export const maxDuration = 240;

/**
 * Server-to-server outbox worker trigger (manual-takeoff-productivity
 * milestone, STEP 14). NOT a user-facing route — authenticated by a shared
 * secret, not Clerk. proxy.ts leaves this path out of auth.protect() so
 * Vercel Cron can reach it; the checks below are the authorization.
 *
 *   1. GET /api/internal/outbox/process — Vercel Cron (`portal/vercel.json`,
 *      every 5 minutes). Vercel sends `Authorization: Bearer <CRON_SECRET>`
 *      only when CRON_SECRET is set on the project. Until that env var
 *      exists, the sweep returns 401.
 *   2. POST { batch_size?: number } with `x-worker-secret` matching
 *      INTERNAL_WORKER_SECRET — the existing manual trigger.
 *   3. Opportunistically, right after every manual-takeoff save/update/
 *      delete (see app/api/takeoff/canvas/manual/route.ts).
 */
async function runBatch(batchSize: number): Promise<NextResponse> {
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = authorizeOutboxCron(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return runBatch(20);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = authorizeOutboxPost(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { batch_size?: number };
  const batchSize = typeof body.batch_size === "number" && body.batch_size > 0 && body.batch_size <= 100 ? body.batch_size : 20;
  return runBatch(batchSize);
}
