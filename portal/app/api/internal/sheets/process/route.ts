import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processSheetBatch } from "@/lib/sheets/sheet-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Secret-gated sheet-index worker. Vercel Cron on the Hobby plan can only
 * run once per day (`portal/vercel.json`). A tighter schedule belongs on
 * pg_cron or a Pro plan; this route still accepts either secret.
 */

function authorize(req: NextRequest): boolean {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const providedWorker = req.headers.get("x-worker-secret");
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (workerSecret && providedWorker === workerSecret) return true;
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    const configured = Boolean(process.env.INTERNAL_WORKER_SECRET || process.env.CRON_SECRET);
    if (!configured) {
      return NextResponse.json({ error: "INTERNAL_WORKER_SECRET or CRON_SECRET is not configured" }, { status: 500 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let batchSize = 20;
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { batch_size?: number };
    if (typeof body.batch_size === "number" && body.batch_size > 0 && body.batch_size <= 100) {
      batchSize = body.batch_size;
    }
  } else {
    const q = Number(req.nextUrl.searchParams.get("batch_size"));
    if (Number.isFinite(q) && q > 0 && q <= 100) batchSize = q;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  try {
    const result = await processSheetBatch(anyDb, `sheet-worker-${Date.now()}`, { batchSize });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return run(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return run(req);
}
