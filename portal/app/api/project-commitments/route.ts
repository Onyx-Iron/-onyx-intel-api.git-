import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("project_commitments")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (data ?? []).map((row: { id: string }) => row.id);
  const { data: lines } = ids.length
    ? await gate.ctx.db.from("project_commitment_lines").select("*").in("commitment_id", ids).eq("tenant_id", gate.ctx.tenantId)
    : { data: [] };
  const allowed = gate.ctx.canReadFinancial;
  return NextResponse.json({
    commitments: (data ?? []).map((row: Record<string, unknown>) => redactAmounts(row, allowed, MONEY_FIELDS)),
    lines: (lines ?? []).map((row: Record<string, unknown>) => redactAmounts(row, allowed, MONEY_FIELDS)),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    title?: string;
    source?: "purchase_order" | "subcontract";
    contact_id?: string | null;
    purchase_order_id?: string | null;
    budget_line_id?: string | null;
    amount?: number;
    description?: string;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  const source = body.source === "purchase_order" ? "purchase_order" : "subcontract";
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const amount = Number(body.amount ?? 0);
  if (!Number.isFinite(amount)) return NextResponse.json({ error: "amount required" }, { status: 400 });

  const { data: commitment, error } = await gate.ctx.db
    .from("project_commitments")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      source,
      title,
      contact_id: body.contact_id ?? null,
      purchase_order_id: body.purchase_order_id ?? null,
      status: "open",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  const { error: lineError } = await gate.ctx.db.from("project_commitment_lines").insert({
    commitment_id: commitment.id,
    tenant_id: gate.ctx.tenantId,
    project_id: gate.projectId,
    budget_line_id: body.budget_line_id ?? null,
    description: body.description?.trim() || title,
    amount,
  });
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 422 });
  return NextResponse.json({ commitment }, { status: 201 });
}
