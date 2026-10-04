import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("time_cards")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("work_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const staffIds = [...new Set((data ?? []).map((row: { staff_member_id: string }) => row.staff_member_id))];
  const { data: staff } = staffIds.length
    ? await gate.ctx.db.from("staff_members").select("id, hourly_rate, name").in("id", staffIds).eq("tenant_id", gate.ctx.tenantId)
    : { data: [] };
  const rates = new Map((staff ?? []).map((row: { id: string; hourly_rate: number | null; name: string }) => [row.id, row]));
  const cards = (data ?? []).map((row: { id: string; staff_member_id: string; hours: number }) => {
    const person = rates.get(row.staff_member_id) as { hourly_rate: number | null; name: string } | undefined;
    return redactAmounts({
      ...row,
      staff_name: person?.name ?? null,
      hourly_rate: person?.hourly_rate ?? null,
      labor_amount: person?.hourly_rate != null ? Number(person.hourly_rate) * Number(row.hours ?? 0) : null,
    }, gate.ctx.canReadFinancial, MONEY_FIELDS);
  });
  return NextResponse.json({ time_cards: cards });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    staff_member_id?: string;
    work_date?: string;
    cost_code?: string | null;
    schedule_task_id?: string | null;
    hours?: number;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  if (!body.staff_member_id || !body.work_date) {
    return NextResponse.json({ error: "staff_member_id and work_date are required" }, { status: 400 });
  }
  const { data, error } = await gate.ctx.db.from("time_cards").insert({
    tenant_id: gate.ctx.tenantId,
    project_id: gate.projectId,
    staff_member_id: body.staff_member_id,
    work_date: body.work_date,
    cost_code: body.cost_code ?? null,
    schedule_task_id: body.schedule_task_id ?? null,
    hours: Number(body.hours ?? 0),
    status: "draft",
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ time_card: data }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    id?: string;
    status?: "approved" | "void";
    budget_line_id?: string | null;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { data: card } = await gate.ctx.db
    .from("time_cards")
    .select("*")
    .eq("id", body.id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "Time card not found" }, { status: 404 });

  if (body.status === "approved") {
    const { data: claimed, error: claimError } = await gate.ctx.db
      .from("time_cards")
      .update({ status: "approved" })
      .eq("id", card.id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 422 });
    if (!claimed) {
      return NextResponse.json({ error: "Time card is no longer a draft" }, { status: 409 });
    }
    const { data: staff } = await gate.ctx.db
      .from("staff_members")
      .select("hourly_rate")
      .eq("id", card.staff_member_id)
      .eq("tenant_id", gate.ctx.tenantId)
      .maybeSingle();
    const rate = Number(staff?.hourly_rate ?? 0);
    const amount = rate * Number(card.hours ?? 0);
    if (amount > 0) {
      const { error: costError } = await gate.ctx.db.from("project_cost_entries").insert({
        tenant_id: gate.ctx.tenantId,
        project_id: gate.projectId,
        budget_line_id: body.budget_line_id ?? null,
        time_card_id: card.id,
        source: "labor",
        amount,
        entry_date: card.work_date,
      });
      if (costError) {
        await gate.ctx.db
          .from("time_cards")
          .update({ status: "draft" })
          .eq("id", card.id)
          .eq("tenant_id", gate.ctx.tenantId)
          .eq("status", "approved");
        return NextResponse.json({ error: costError.message }, { status: 422 });
      }
    }
    return NextResponse.json({ status: "approved" });
  }

  if (body.status === "void") {
    const { data: claimed, error: claimError } = await gate.ctx.db
      .from("time_cards")
      .update({ status: "void" })
      .eq("id", card.id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId)
      .neq("status", "void")
      .select("id")
      .maybeSingle();
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 422 });
    if (!claimed) return NextResponse.json({ status: "void" });
    const { error: dropError } = await gate.ctx.db
      .from("project_cost_entries")
      .delete()
      .eq("time_card_id", card.id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId);
    if (dropError) return NextResponse.json({ error: dropError.message }, { status: 422 });
    return NextResponse.json({ status: "void" });
  }

  return NextResponse.json({ status: card.status });
}
