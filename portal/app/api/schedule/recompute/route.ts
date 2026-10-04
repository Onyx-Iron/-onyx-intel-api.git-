import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { CpmCycleError } from "@/lib/project-file/cpm";
import { recomputeProjectSchedule } from "@/lib/project-file/schedule-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as { project_id?: string };
  const gate = await projectContext(body.project_id ?? req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  try {
    const result = await recomputeProjectSchedule(gate.ctx.db, gate.ctx.tenantId, gate.projectId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CpmCycleError) return NextResponse.json({ error: err.message }, { status: 409 });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
