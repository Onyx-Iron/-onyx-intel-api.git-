import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

const CHILD_TABLES = [
  "daily_log_manpower",
  "daily_log_delays",
  "daily_log_equipment",
  "daily_log_deliveries",
  "daily_log_quantities",
] as const;

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

  const groups: Array<{ table: (typeof CHILD_TABLES)[number]; rows: Array<Record<string, unknown>> | undefined }> = [
    { table: "daily_log_manpower", rows: body.manpower },
    { table: "daily_log_delays", rows: body.delays },
    { table: "daily_log_equipment", rows: body.equipment },
    { table: "daily_log_deliveries", rows: body.deliveries },
    { table: "daily_log_quantities", rows: body.quantities },
  ];
  for (const group of groups) {
    if (!group.rows) continue;
    await gate.ctx.db.from(group.table).delete().eq("daily_log_id", body.daily_log_id).eq("tenant_id", gate.ctx.tenantId);
    if (group.rows.length === 0) continue;
    const { error } = await gate.ctx.db.from(group.table).insert(group.rows.map((row) => ({
      ...row,
      id: undefined,
      daily_log_id: body.daily_log_id,
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
    })));
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
