import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditInsert, auditDelete } from "@/lib/audit";
import { summarizeLedger, type LedgerRow } from "@/lib/math/civil-scope";

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
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({})) as Body;
    if (!body.project_id || !body.direction || !body.material_type) {
      return NextResponse.json({ error: "project_id + direction + material_type required" }, { status: 400 });
    }
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(body.project_id, tenantId);
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

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "civil_material_ledger",
      record_id: data.id,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ row: data });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: before } = await anyDb.from("civil_material_ledger")
      .select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

    const { error } = await anyDb.from("civil_material_ledger").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "civil_material_ledger",
      record_id: id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
