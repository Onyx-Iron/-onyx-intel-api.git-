import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/public/procurement-request/[id] — UNAUTHENTICATED, for the
 * public vendor bid page. Returns only what a supplier needs to price a
 * quote (description, quantity, unit, due date, status) — never the
 * tenant's other bids, pricing, or any tenant-identifying data beyond the
 * project name, so one vendor can't see a competitor's pricing.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: request, error } = await anyDb
    .from("marketplace_requests")
    .select("id, item_description, quantity, unit, required_date, status, project_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: project } = await anyDb.from("projects").select("name").eq("id", request.project_id).maybeSingle();

  return NextResponse.json({
    id: request.id,
    item_description: request.item_description,
    quantity: request.quantity,
    unit: request.unit,
    required_date: request.required_date,
    status: request.status,
    project_name: project?.name ?? null,
  });
}
