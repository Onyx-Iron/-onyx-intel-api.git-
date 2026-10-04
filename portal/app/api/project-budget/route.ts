import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite } from "@/lib/project-file/api";
import { loadCurrentBudget } from "@/lib/project-file/budget-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  try {
    const current = await loadCurrentBudget(gate.ctx.db, gate.ctx.tenantId, gate.projectId);
    if (!current) return NextResponse.json({ budget: null, lines: [], totals: null, unassigned_actual: 0 });
    const lines = current.lines.map((line) => redactAmounts(line as unknown as Record<string, unknown>, gate.ctx.canReadFinancial, MONEY_FIELDS));
    const totals = gate.ctx.canReadFinancial ? current.totals : null;
    return NextResponse.json({
      budget: redactAmounts(current.budget as Record<string, unknown>, gate.ctx.canReadFinancial, ["total_price"]),
      lines,
      totals,
      unassigned_actual: gate.ctx.canReadFinancial ? current.unassigned_actual : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as { project_id?: string; budget_line_id?: string; forecast_override?: number | null };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  if (!body.budget_line_id) return NextResponse.json({ error: "budget_line_id required" }, { status: 400 });
  const override = body.forecast_override == null ? null : Number(body.forecast_override);
  if (override != null && !Number.isFinite(override)) {
    return NextResponse.json({ error: "forecast_override must be a number" }, { status: 400 });
  }
  const { data, error } = await gate.ctx.db
    .from("project_budget_lines")
    .update({ forecast_override: override })
    .eq("id", body.budget_line_id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .select("id, forecast_override")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({
    line: redactAmounts(data as Record<string, unknown>, gate.ctx.canReadFinancial, MONEY_FIELDS),
  });
}
