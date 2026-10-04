import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { addApprovedChange } from "@/lib/project-file/budget-store";
import { eventPostsBudget } from "@/lib/project-file/money";
import { shiftTaskDates } from "@/lib/project-file/cpm";
import { recomputeProjectSchedule } from "@/lib/project-file/schedule-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { project_id?: string; action?: "approve" | "void"; apply_schedule?: boolean };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;

  const { data: event, error } = await gate.ctx.db
    .from("change_events")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Change event not found" }, { status: 404 });
  if (event.status === "approved" || event.status === "void") {
    return NextResponse.json({ error: `already ${event.status}` }, { status: 409 });
  }

  if (body.action === "void") {
    const { error: voidError } = await gate.ctx.db
      .from("change_events")
      .update({ status: "void" })
      .eq("id", id)
      .eq("tenant_id", gate.ctx.tenantId);
    if (voidError) return NextResponse.json({ error: voidError.message }, { status: 422 });
    return NextResponse.json({ status: "void", posted_budget: eventPostsBudget("void") });
  }

  if (body.action !== "approve") return NextResponse.json({ error: "action must be approve or void" }, { status: 400 });

  const { data: lines, error: lineError } = await gate.ctx.db
    .from("change_event_lines")
    .select("*")
    .eq("change_event_id", id)
    .eq("tenant_id", gate.ctx.tenantId);
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  const eventLines = lines ?? [];
  const amount = eventLines.reduce((sum: number, line: { amount: number | null }) => sum + Number(line.amount ?? 0), 0);

  const { data: changeOrder, error: coError } = await gate.ctx.db
    .from("change_order_items")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      description: event.title,
      status: "approved",
      amount,
      approved_date: new Date().toISOString().slice(0, 10),
      meta: {},
    })
    .select("id")
    .single();
  if (coError) return NextResponse.json({ error: coError.message }, { status: 422 });

  const allocations = eventLines
    .filter((line: { budget_line_id: string | null }) => line.budget_line_id)
    .map((line: { budget_line_id: string; amount: number }) => ({
      budgetLineId: line.budget_line_id,
      amount: Number(line.amount ?? 0),
    }));
  if (eventPostsBudget("approved") && allocations.length) {
    await addApprovedChange(gate.ctx.db, gate.ctx.tenantId, gate.projectId, allocations);
  }

  for (const line of eventLines) {
    if (!line.budget_line_id) continue;
    await gate.ctx.db.from("project_record_links").insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      from_type: "change_order",
      from_id: changeOrder.id,
      to_type: "budget_line",
      to_id: line.budget_line_id,
      link_role: "prices",
    });
  }

  if (body.apply_schedule && event.schedule_task_id && Number(event.day_impact) !== 0) {
    const { data: task } = await gate.ctx.db
      .from("schedule_tasks")
      .select("id, start_date, end_date")
      .eq("id", event.schedule_task_id)
      .eq("tenant_id", gate.ctx.tenantId)
      .maybeSingle();
    if (task) {
      const shifted = shiftTaskDates(
        { start_date: task.start_date, end_date: task.end_date },
        Number(event.day_impact),
      );
      await gate.ctx.db
        .from("schedule_tasks")
        .update(shifted)
        .eq("id", task.id)
        .eq("tenant_id", gate.ctx.tenantId);
      await recomputeProjectSchedule(gate.ctx.db, gate.ctx.tenantId, gate.projectId);
    }
  }

  const { error: approveError } = await gate.ctx.db
    .from("change_events")
    .update({ status: "approved", change_order_id: changeOrder.id })
    .eq("id", id)
    .eq("tenant_id", gate.ctx.tenantId);
  if (approveError) return NextResponse.json({ error: approveError.message }, { status: 422 });

  return NextResponse.json({ status: "approved", change_order_id: changeOrder.id, posted_budget: true });
}
