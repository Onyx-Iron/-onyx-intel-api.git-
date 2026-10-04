import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

const TABLES = {
  rfi: "rfi_items",
  submittal: "submittal_items",
  change_order: "change_order_items",
  punch: "punch_list_items",
} as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  const gate = await projectContext(projectId);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;

  const kind = String(body.kind ?? "") as keyof typeof TABLES;
  const table = TABLES[kind];
  if (!table) return NextResponse.json({ error: "kind must be rfi, submittal, change_order, or punch" }, { status: 400 });
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data, error } = await gate.ctx.db
    .from(table)
    .update({
      ball_contact_id: typeof body.ball_contact_id === "string" && body.ball_contact_id ? body.ball_contact_id : null,
      ball_since: typeof body.ball_since === "string" && body.ball_since ? body.ball_since : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .select("id, ball_contact_id, ball_since")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ item: data });
}
