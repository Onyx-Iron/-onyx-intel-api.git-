import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { PRODUCTION_TABLES, productionWrites, type ProductionTable } from "@/lib/project-file/production";

export const runtime = "nodejs";

const CHILD_TABLES: readonly ProductionTable[] = PRODUCTION_TABLES;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const logId = req.nextUrl.searchParams.get("daily_log_id");
  const result: Record<string, unknown[]> = {};
  for (const table of CHILD_TABLES) {
    let query = gate.ctx.db.from(table).select("*").eq("tenant_id", gate.ctx.tenantId).eq("project_id", gate.projectId);
    if (logId) query = query.eq("daily_log_id", logId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    result[table] = data ?? [];
  }
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    daily_log_id?: string;
    manpower?: Array<Record<string, unknown>>;
    delays?: Array<Record<string, unknown>>;
    equipment?: Array<Record<string, unknown>>;
    deliveries?: Array<Record<string, unknown>>;
    quantities?: Array<Record<string, unknown>>;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  if (!body.daily_log_id) return NextResponse.json({ error: "daily_log_id required" }, { status: 400 });

  const { data: log } = await gate.ctx.db
    .from("daily_logs")
    .select("id")
    .eq("id", body.daily_log_id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .maybeSingle();
  if (!log) return NextResponse.json({ error: "Daily log not found on this project" }, { status: 404 });

  // Insert the replacement first. A failed write must leave the previous
  // crew, delay, and installed-quantity rows in place.
  for (const group of productionWrites(body)) {
    const { data: existing, error: existingError } = await gate.ctx.db
      .from(group.table)
      .select("id")
      .eq("daily_log_id", body.daily_log_id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const { error } = await gate.ctx.db.from(group.table).insert(group.rows.map((row) => ({
      ...row,
      daily_log_id: body.daily_log_id,
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
    })));
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    const oldIds = (existing ?? []).map((row: { id: string }) => row.id);
    if (oldIds.length === 0) continue;
    const { error: deleteError } = await gate.ctx.db
      .from(group.table)
      .delete()
      .in("id", oldIds)
      .eq("daily_log_id", body.daily_log_id)
      .eq("tenant_id", gate.ctx.tenantId)
      .eq("project_id", gate.projectId);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
