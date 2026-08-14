import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { summarizeLedger, type LedgerRow } from "@/lib/math/civil-scope";
import { hasPermission } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * Civil material ledger — every truck of import, export, and stockpile
 * transfer, so import totals + haul-distance analytics roll up cleanly.
 *
 * GET    ?project_id=  → { rows, totals }
 * POST   { project_id, direction, material_type, quantity_bcy?, quantity_ton?, ... }
 * DELETE ?id=
 */

interface Body {
  project_id?: string;
  direction?: LedgerRow["direction"];
  material_type?: string;
  quantity_bcy?: number;
  quantity_ton?: number;
  unit_price?: number;
  unit_of_measure?: string;
  source_destination?: string;
  haul_distance_mi?: number;
  scope_ref?: string;
  notes?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any).from("civil_material_ledger").select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: false });

  const rows = (data ?? []) as LedgerRow[];
  return NextResponse.json({ rows, totals: summarizeLedger(rows) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.project_id || !body.direction || !body.material_type) {
    return NextResponse.json({ error: "project_id + direction + material_type required" }, { status: 400 });
  }
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!(await hasPermission(tenantId, userId, "field", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb.from("civil_material_ledger").insert({
    tenant_id: tenantId, project_id: body.project_id,
    direction: body.direction, material_type: body.material_type,
    quantity_bcy: body.quantity_bcy ?? null,
    quantity_ton: body.quantity_ton ?? null,
    unit_price:   body.unit_price   ?? null,
    unit_of_measure: body.unit_of_measure ?? "CY",
    source_destination: body.source_destination ?? null,
    haul_distance_mi: body.haul_distance_mi ?? null,
    scope_ref: body.scope_ref ?? null,
    notes: body.notes ?? null,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!(await hasPermission(tenantId, userId, "field", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("civil_material_ledger").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
