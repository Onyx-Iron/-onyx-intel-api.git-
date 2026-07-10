import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { calcConstructionEntrance } from "@/lib/math/civil-scope";
import { mirrorCivilItemsToTakeoff } from "@/lib/estimating/civil-mirror";

export const runtime = "nodejs";

interface Body {
  project_id?: string;
  name?: string;
  length_ft?: number;
  width_ft?: number;
  depth_in?: number;
  stone_size?: string;
  fabric_underlayment?: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any).from("civil_construction_entrances").select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: true });
  return NextResponse.json({ entrances: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.project_id || !body.name) return NextResponse.json({ error: "project_id + name required" }, { status: 400 });

  const length_ft = Number(body.length_ft ?? 50);
  const width_ft  = Number(body.width_ft ?? 20);
  const depth_in  = Number(body.depth_in ?? 8);
  const fabric    = body.fabric_underlayment !== false;
  const computed  = calcConstructionEntrance({ length_ft, width_ft, depth_in, fabric_underlayment: fabric });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data, error } = await anyDb.from("civil_construction_entrances").insert({
    tenant_id: tenantId, project_id: body.project_id,
    name: body.name, length_ft, width_ft, depth_in,
    stone_size: body.stone_size ?? '2-3" crushed stone',
    fabric_underlayment: fabric,
    computed,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await mirrorCivilItemsToTakeoff(anyDb, tenantId, body.project_id, null, "civil_construction_entrances", data?.id ?? "", [{
    label: `Stabilized construction entrance: ${body.name}`,
    csi_code: "31-25-00",
    quantity: computed.area_sf,
    unit: "SF",
  }], userId);

  return NextResponse.json({ entrance: data });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("civil_construction_entrances").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
