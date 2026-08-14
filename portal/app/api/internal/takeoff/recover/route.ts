import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { processOutboxBatch } from "@/lib/estimating/outbox-worker";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const configured = process.env.TAKEOFF_RECOVERY_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: recovered, error } = await anyDb.rpc("recover_expired_takeoff_units", { p_limit: 50, p_max_attempts: 8 });
    if (error) throw error;
    const outbox = await processOutboxBatch(anyDb, `scheduled:${crypto.randomUUID()}`, { batchSize: 50 });
    return NextResponse.json({ recoveredUnits: recovered?.length ?? 0, outbox });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const GET = POST;
