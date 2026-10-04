import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("project_cost_entries")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    entries: (data ?? []).map((row: Record<string, unknown>) => redactAmounts(row, gate.ctx.canReadFinancial, MONEY_FIELDS)),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    invoice_id?: string | null;
    budget_line_id?: string | null;
    amount?: number;
    entry_date?: string | null;
    source?: string;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) return NextResponse.json({ error: "amount required" }, { status: 400 });
  const { data, error } = await gate.ctx.db
    .from("project_cost_entries")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      invoice_id: body.invoice_id ?? null,
      budget_line_id: body.budget_line_id ?? null,
      amount,
      entry_date: body.entry_date ?? null,
      source: body.source === "labor" ? "labor" : "invoice",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ entry: data }, { status: 201 });
}
