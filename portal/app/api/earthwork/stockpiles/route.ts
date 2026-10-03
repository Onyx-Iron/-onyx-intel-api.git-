import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert, auditDelete } from "@/lib/audit";
import { calcStockpile } from "@/lib/math/civil-scope";
import { mirrorCivilItemsToTakeoff } from "@/lib/estimating/civil-mirror";

export const runtime = "nodejs";

interface Body {
  project_id?: string;
  name?: string;
  material_type?: string;
  volume_bcy?: number;
  swell_factor?: number;
  location_notes?: string;
  reuse_planned?: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any).from("civil_stockpiles").select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: true });

  const withComputed = ((data ?? []) as Array<Record<string, unknown>>).map((s) => ({
    ...s,
    computed: calcStockpile({ volume_bcy: Number(s.volume_bcy ?? 0), swell_factor: Number(s.swell_factor ?? 1.15) }),
  }));
  return NextResponse.json({ stockpiles: withComputed });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.project_id || !body.name || !body.material_type) {
    return NextResponse.json({ error: "project_id + name + material_type required" }, { status: 400 });
  }
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
  } catch {
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb.from("civil_stockpiles").insert({
    tenant_id: tenantId, project_id: body.project_id,
    name: body.name, material_type: body.material_type,
    volume_bcy: Number(body.volume_bcy ?? 0),
    swell_factor: Number(body.swell_factor ?? 1.15),
    location_notes: body.location_notes ?? null,
    reuse_planned: body.reuse_planned !== false,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditInsert({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_stockpiles",
    record_id: data.id,
    new_values: data as unknown as Record<string, unknown>,
  });

  const computed = calcStockpile({ volume_bcy: Number(body.volume_bcy ?? 0), swell_factor: Number(body.swell_factor ?? 1.15) });
  await mirrorCivilItemsToTakeoff(anyDb, tenantId, body.project_id, null, "civil_stockpiles", data?.id ?? "", [{
    label: `Stockpile: ${body.name} (${body.material_type})`,
    csi_code: "31-23-00",
    quantity: computed.ccy,
    unit: "CY",
  }], userId);

  return NextResponse.json({ stockpile: data });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
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

  const { data: before } = await anyDb.from("civil_stockpiles")
    .select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await anyDb.from("civil_stockpiles").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditDelete({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_stockpiles",
    record_id: id,
    old_values: (before ?? null) as unknown as Record<string, unknown> | null,
  });

  return NextResponse.json({ ok: true });
}
