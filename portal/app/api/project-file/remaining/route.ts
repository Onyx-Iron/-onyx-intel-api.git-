import { NextRequest, NextResponse } from "next/server";
import { projectContext } from "@/lib/project-file/api";
import { loadCurrentBudget } from "@/lib/project-file/budget-store";
import { remainingQuantity } from "@/lib/project-file/records";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const current = await loadCurrentBudget(gate.ctx.db, gate.ctx.tenantId, gate.projectId);
  const { data: quantities } = await gate.ctx.db
    .from("daily_log_quantities")
    .select("budget_line_id, quantity")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId);
  const installed = new Map<string, number>();
  for (const row of quantities ?? []) {
    if (!row.budget_line_id) continue;
    installed.set(row.budget_line_id, (installed.get(row.budget_line_id) ?? 0) + Number(row.quantity ?? 0));
  }
  const lines = (current?.lines ?? []).map((line) => ({
    id: line.id,
    description: line.description,
    source_takeoff_id: line.source_takeoff_id,
    budget_quantity: line.quantity,
    installed: installed.get(line.id) ?? 0,
    remaining: remainingQuantity(line.quantity == null ? null : Number(line.quantity), installed.get(line.id) ?? 0),
  }));
  const civil = lines.filter((line) => line.source_takeoff_id);
  return NextResponse.json({ lines, civil });
}
