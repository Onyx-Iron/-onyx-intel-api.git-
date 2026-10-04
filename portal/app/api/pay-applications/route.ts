import { NextRequest, NextResponse } from "next/server";
import { MONEY_FIELDS, projectContext, redactAmounts, requireProjectWrite, viewerContactId } from "@/lib/project-file/api";
import { computePayLine, payAppInvoiceTotals, waiverCoversDraw } from "@/lib/project-file/money";
import { subCanSeeRecord } from "@/lib/project-file/records";

export const runtime = "nodejs";

interface SovItem {
  description?: string;
  cost_code?: string | null;
  total_price?: number;
  is_allowance?: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("pay_applications")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let rows = data ?? [];
  if (gate.ctx.role === "Subcontractor") {
    const contactId = await viewerContactId(gate.ctx.db, gate.ctx.tenantId, gate.projectId, gate.ctx.userId);
    rows = rows.filter((row: { responsible_contact_id: string | null }) =>
      subCanSeeRecord({ role: "Subcontractor", contactId }, row.responsible_contact_id),
    );
  }
  return NextResponse.json({
    pay_applications: rows.map((row: Record<string, unknown>) => redactAmounts(row, gate.ctx.canReadFinancial, MONEY_FIELDS)),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    side?: "owner" | "commitment";
    number?: string;
    draw_number?: string;
    retainage_pct?: number;
    commitment_id?: string | null;
    responsible_contact_id?: string | null;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  const side = body.side === "commitment" ? "commitment" : "owner";
  const retainagePct = Number(body.retainage_pct ?? 0);

  const { data: app, error } = await gate.ctx.db
    .from("pay_applications")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      side,
      number: body.number ?? null,
      draw_number: body.draw_number ?? null,
      status: "draft",
      commitment_id: body.commitment_id ?? null,
      responsible_contact_id: body.responsible_contact_id ?? null,
      retainage_pct: Number.isFinite(retainagePct) ? retainagePct : 0,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  let sourceLines: Array<{ description: string; cost_code: string | null; scheduled_value: number; is_allowance: boolean }> = [];
  if (side === "owner") {
    const { data: sov } = await gate.ctx.db
      .from("estimate_sov")
      .select("rows, created_at")
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const groups = (sov?.rows ?? []) as Array<{ items?: SovItem[] }>;
    sourceLines = groups.flatMap((group) => (group.items ?? []).map((item) => ({
      description: item.description ?? "SOV line",
      cost_code: item.cost_code ?? null,
      scheduled_value: Number(item.total_price ?? 0),
      is_allowance: Boolean(item.is_allowance),
    })));
  } else if (body.commitment_id) {
    const { data: commitmentLines } = await gate.ctx.db
      .from("project_commitment_lines")
      .select("description, amount")
      .eq("commitment_id", body.commitment_id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId);
    sourceLines = (commitmentLines ?? []).map((line: { description: string; amount: number }) => ({
      description: line.description,
      cost_code: null,
      scheduled_value: Number(line.amount ?? 0),
      is_allowance: false,
    }));
  }

  if (sourceLines.length) {
    const { error: lineError } = await gate.ctx.db.from("pay_application_lines").insert(sourceLines.map((line) => {
      const math = computePayLine({
        scheduledValue: line.scheduled_value,
        previous: 0,
        thisPeriod: 0,
        storedMaterials: 0,
        retainagePct,
      });
      return {
        pay_application_id: app.id,
        tenant_id: gate.ctx.tenantId,
        project_id: gate.projectId,
        description: line.description,
        cost_code: line.cost_code,
        scheduled_value: line.scheduled_value,
        previous_amount: 0,
        this_period: 0,
        stored_materials: 0,
        retainage: math.retainage,
        balance: math.balance,
        is_allowance: line.is_allowance,
      };
    }));
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 422 });
  }

  return NextResponse.json({ pay_application: app }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    id?: string;
    status?: "payable" | "issued" | "void";
    lines?: Array<{ id: string; this_period?: number; stored_materials?: number; previous_amount?: number }>;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "financial");
  if (denied) return denied;
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: app, error } = await gate.ctx.db
    .from("pay_applications")
    .select("*")
    .eq("id", body.id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!app) return NextResponse.json({ error: "Pay application not found" }, { status: 404 });

  const { data: existingLines } = await gate.ctx.db
    .from("pay_application_lines")
    .select("*")
    .eq("pay_application_id", app.id)
    .eq("tenant_id", gate.ctx.tenantId);
  for (const patch of body.lines ?? []) {
    const current = (existingLines ?? []).find((line: { id: string }) => line.id === patch.id);
    if (!current) continue;
    const math = computePayLine({
      scheduledValue: Number(current.scheduled_value ?? 0),
      previous: patch.previous_amount ?? Number(current.previous_amount ?? 0),
      thisPeriod: patch.this_period ?? Number(current.this_period ?? 0),
      storedMaterials: patch.stored_materials ?? Number(current.stored_materials ?? 0),
      retainagePct: Number(app.retainage_pct ?? 0),
    });
    await gate.ctx.db.from("pay_application_lines").update({
      previous_amount: patch.previous_amount ?? current.previous_amount,
      this_period: patch.this_period ?? current.this_period,
      stored_materials: patch.stored_materials ?? current.stored_materials,
      retainage: math.retainage,
      balance: math.balance,
    }).eq("id", patch.id).eq("tenant_id", gate.ctx.tenantId);
  }

  if (body.status === "payable") {
    if (app.status !== "draft") {
      return NextResponse.json({ error: `Pay application is already ${app.status}` }, { status: 409 });
    }
    const { data: freshLines } = await gate.ctx.db
      .from("pay_application_lines")
      .select("this_period, stored_materials, previous_amount")
      .eq("pay_application_id", app.id)
      .eq("tenant_id", gate.ctx.tenantId);
    const totals = payAppInvoiceTotals(
      (freshLines ?? []).map((line: { this_period: number; stored_materials: number; previous_amount: number }) => ({
        previous: Number(line.previous_amount ?? 0),
        thisPeriod: Number(line.this_period ?? 0),
        storedMaterials: Number(line.stored_materials ?? 0),
      })),
      Number(app.retainage_pct ?? 0),
    );
    const { data: waivers } = await gate.ctx.db
      .from("lien_waivers")
      .select("status, amount, draw_number")
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId);
    if (!waiverCoversDraw(waivers ?? [], app.draw_number, totals.amount)) {
      return NextResponse.json({ error: "Lien waivers do not cover this draw" }, { status: 409 });
    }
    const { data: claimed, error: claimError } = await gate.ctx.db
      .from("pay_applications")
      .update({ status: "payable" })
      .eq("id", app.id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 422 });
    if (!claimed) {
      return NextResponse.json({ error: "Pay application is already payable" }, { status: 409 });
    }
    const direction = app.side === "commitment" ? "payable" : "receivable";
    const { data: invoice, error: invoiceError } = await gate.ctx.db.from("invoices").insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      direction,
      vendor_or_customer: app.side === "commitment" ? "Commitment" : "Owner",
      description: `Pay app ${app.number ?? app.id}`,
      amount: totals.amount,
      retainage: totals.retainage,
      status: "open",
      invoice_date: new Date().toISOString().slice(0, 10),
    }).select("id").single();
    if (invoiceError) {
      await gate.ctx.db
        .from("pay_applications")
        .update({ status: "draft" })
        .eq("id", app.id)
        .eq("tenant_id", gate.ctx.tenantId)
        .eq("status", "payable");
      return NextResponse.json({ error: invoiceError.message }, { status: 422 });
    }
    await gate.ctx.db
      .from("pay_applications")
      .update({ invoice_id: invoice.id })
      .eq("id", app.id)
      .eq("tenant_id", gate.ctx.tenantId);
    return NextResponse.json({ status: "payable", invoice_id: invoice.id, amount: totals.amount, retainage: totals.retainage });
  }

  if (body.status === "issued" || body.status === "void") {
    await gate.ctx.db.from("pay_applications").update({ status: body.status }).eq("id", app.id).eq("tenant_id", gate.ctx.tenantId);
  }
  return NextResponse.json({ ok: true });
}
