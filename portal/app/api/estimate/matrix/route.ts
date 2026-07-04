import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * Pricing Matrix — dedicated CRUD for `project_estimates` + `project_financial_settings`.
 * Separate from `/api/estimate` (legacy `estimate_items` table) so both live side by side.
 *
 * GET    ?project_id=            → { rows, settings }
 * POST   { project_id, rows?, settings? }  → bulk upsert rows + save settings
 * PATCH  ?id=                    → partial update to one row
 * DELETE ?id=                    → delete one row
 */

interface EstimateRow {
  id?: string;
  cost_code?: string | null;
  description?: string | null;
  quantity?: number;
  unit?: string | null;
  labor_unit?: number;
  material_unit?: number;
  equipment_unit?: number;
  subcontractor_unit?: number;
  trucking_unit?: number;
  disposal_unit?: number;
  notes?: string | null;
  sort_order?: number;
}

const num = (v: number | undefined, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [rowsRes, settingsRes] = await Promise.all([
    anyDb.from("project_estimates")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
    anyDb.from("project_financial_settings")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .maybeSingle(),
  ]);

  const settings = settingsRes.data ?? {
    project_id: projectId,
    overhead_pct: 10,
    profit_pct: 15,
    contingency_pct: 5,
  };
  return NextResponse.json({ rows: rowsRes.data ?? [], settings });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    rows?: EstimateRow[];
    settings?: { overhead_pct?: number; profit_pct?: number; contingency_pct?: number };
  };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  if (body.settings) {
    const s = body.settings;
    await anyDb.from("project_financial_settings").upsert(
      {
        project_id: body.project_id,
        tenant_id: tenantId,
        overhead_pct: num(s.overhead_pct, 10),
        profit_pct: num(s.profit_pct, 15),
        contingency_pct: num(s.contingency_pct, 5),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
  }

  if (Array.isArray(body.rows) && body.rows.length > 0) {
    const payload = body.rows.map((r, i) => ({
      id: r.id,
      tenant_id: tenantId,
      project_id: body.project_id,
      cost_code: r.cost_code ?? null,
      description: r.description ?? null,
      quantity: num(r.quantity, 0),
      unit: r.unit ?? null,
      labor_unit: num(r.labor_unit, 0),
      material_unit: num(r.material_unit, 0),
      equipment_unit: num(r.equipment_unit, 0),
      subcontractor_unit: num(r.subcontractor_unit, 0),
      trucking_unit: num(r.trucking_unit, 0),
      disposal_unit: num(r.disposal_unit, 0),
      notes: r.notes ?? null,
      sort_order: r.sort_order ?? i,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await anyDb.from("project_estimates").upsert(payload, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({})) as EstimateRow;

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: (keyof EstimateRow)[] = [
    "cost_code", "description", "unit", "notes",
    "quantity", "labor_unit", "material_unit", "equipment_unit",
    "subcontractor_unit", "trucking_unit", "disposal_unit", "sort_order",
  ];
  for (const k of fields) if (k in body) patch[k as string] = body[k] as unknown;

  const { error } = await anyDb.from("project_estimates")
    .update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { error } = await anyDb.from("project_estimates").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
