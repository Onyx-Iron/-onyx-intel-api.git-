import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite, viewerContactId } from "@/lib/project-file/api";
import { clientCanSeeChangeEvent } from "@/lib/project-file/records";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("change_events")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const events = (data ?? []).filter((row: { status: string }) => clientCanSeeChangeEvent(
    gate.ctx.role === "ClientView" ? "ClientView" : "other",
    row.status,
  ));
  const ids = events.map((row: { id: string }) => row.id);
  const { data: lines } = ids.length
    ? await gate.ctx.db.from("change_event_lines").select("*").in("change_event_id", ids).eq("tenant_id", gate.ctx.tenantId)
    : { data: [] };
  const contactId = gate.ctx.role === "Subcontractor"
    ? await viewerContactId(gate.ctx.db, gate.ctx.tenantId, gate.projectId, gate.ctx.userId)
    : null;
  void contactId;
  return NextResponse.json({
    events: events.map((row: Record<string, unknown>) => redactAmounts(row, gate.ctx.canReadFinancial, MONEY_FIELDS)),
    lines: (lines ?? []).map((row: Record<string, unknown>) => redactAmounts(row, gate.ctx.canReadFinancial, MONEY_FIELDS)),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    title?: string;
    status?: "draft" | "pending";
    rfi_id?: string | null;
    schedule_task_id?: string | null;
    day_impact?: number;
    lines?: Array<{ budget_line_id?: string | null; takeoff_id?: string | null; description?: string; quantity?: number | null; unit_price?: number | null; amount?: number }>;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const status = body.status === "pending" ? "pending" : "draft";

  const { data: event, error } = await gate.ctx.db
    .from("change_events")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      title,
      status,
      rfi_id: body.rfi_id ?? null,
      schedule_task_id: body.schedule_task_id ?? null,
      day_impact: Number.isFinite(body.day_impact) ? Number(body.day_impact) : 0,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  const lines = body.lines ?? [];
  if (lines.length) {
    const { error: lineError } = await gate.ctx.db.from("change_event_lines").insert(lines.map((line) => {
      const quantity = line.quantity == null ? null : Number(line.quantity);
      const unitPrice = line.unit_price == null ? null : Number(line.unit_price);
      const amount = line.amount != null
        ? Number(line.amount)
        : (quantity != null && unitPrice != null ? quantity * unitPrice : 0);
      return {
        change_event_id: event.id,
        tenant_id: gate.ctx.tenantId,
        project_id: gate.projectId,
        budget_line_id: line.budget_line_id ?? null,
        takeoff_id: line.takeoff_id ?? null,
        description: line.description?.trim() || title,
        quantity,
        unit_price: unitPrice,
        amount: Number.isFinite(amount) ? amount : 0,
      };
    }));
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 422 });
  }
  return NextResponse.json({ event }, { status: 201 });
}
