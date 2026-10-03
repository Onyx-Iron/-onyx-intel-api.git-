import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert, auditUpdate, auditDelete } from "@/lib/audit";
import { calcPipeEmbedment, type PipeRunInput } from "@/lib/math/civil-scope";
import { mirrorCivilItemsToTakeoff, type CivilMirrorRow } from "@/lib/estimating/civil-mirror";

function csiForSystem(system: string): string {
  const s = system.toLowerCase();
  if (s.includes("sanitary")) return "33-30-00";
  if (s.includes("storm")) return "33-40-00";
  return "33-10-00"; // water / fire / other pressure systems
}

export const runtime = "nodejs";

/**
 * GET    ?project_id=  → list runs (with fresh recomputes)
 * POST   { project_id, ...pipe run fields }  → create + compute
 * PATCH  ?id=  { ...changes }  → update + recompute
 * DELETE ?id=
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data } = await anyDb.from("civil_pipe_runs").select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: true });
  return NextResponse.json({ runs: data ?? [] });
}

interface Body extends Partial<PipeRunInput> {
  project_id?: string;
  name?: string;
  system?: string;
  material?: string;
  bedding_material?: string;
  backfill_material?: string;
  page_id?: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.project_id || !body.name || !body.system) {
    return NextResponse.json({ error: "project_id, name, system required" }, { status: 400 });
  }
  const input = pipeInputFromBody(body);
  const computed = calcPipeEmbedment(input);

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

  const { data, error } = await anyDb.from("civil_pipe_runs").insert({
    tenant_id: tenantId,
    project_id: body.project_id,
    page_id: body.page_id ?? null,
    name: body.name,
    system: body.system,
    material: body.material ?? null,
    diameter_in: input.diameter_in,
    length_lf: input.length_lf,
    avg_depth_ft: input.avg_depth_ft,
    trench_width_ft: input.trench_width_ft,
    bedding_depth_in: input.bedding_depth_in ?? 6,
    haunch_depth_in: input.haunch_depth_in ?? 6,
    initial_backfill_over_pipe_in: input.initial_backfill_over_pipe_in ?? 12,
    bedding_material: body.bedding_material ?? "#57 stone",
    backfill_material: body.backfill_material ?? "native suitable",
    swell_factor: input.swell_factor ?? 1.15,
    shrink_factor: input.shrink_factor ?? 0.85,
    computed,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditInsert({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_pipe_runs",
    record_id: data.id,
    new_values: data as unknown as Record<string, unknown>,
  });

  const takeoffRows: CivilMirrorRow[] = [
    {
      label: `${body.name} (${body.system} pipe, ${input.diameter_in}" dia)`,
      csi_code: csiForSystem(body.system),
      quantity: input.length_lf,
      unit: "LF",
    },
    {
      label: `${body.name} trench excavation`,
      csi_code: "31-23-16",
      quantity: computed.trench_excavation_bcy,
      unit: "CY",
    },
  ];
  await mirrorCivilItemsToTakeoff(anyDb, tenantId, body.project_id, body.page_id ?? null, "civil_pipe_runs", data?.id ?? "", takeoffRows, userId);

  return NextResponse.json({ run: data });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json().catch(() => ({})) as Body;

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: existing } = await anyDb.from("civil_pipe_runs").select("*").eq("id", id).eq("tenant_id", tenantId).single();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const merged = { ...existing, ...body } as Body;
  const computed = calcPipeEmbedment(pipeInputFromBody(merged));

  const patch = {
    ...body,
    tenant_id: tenantId,
    project_id: existing.project_id,
    computed,
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await anyDb.from("civil_pipe_runs").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditUpdate({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_pipe_runs",
    record_id: id,
    old_values: existing as unknown as Record<string, unknown>,
    new_values: (updated ?? { ...patch }) as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, computed });
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

  const { data: before } = await anyDb.from("civil_pipe_runs")
    .select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await anyDb.from("civil_pipe_runs").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditDelete({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_pipe_runs",
    record_id: id,
    old_values: (before ?? null) as unknown as Record<string, unknown> | null,
  });

  return NextResponse.json({ ok: true });
}

function pipeInputFromBody(b: Body): PipeRunInput {
  return {
    length_lf: Number(b.length_lf ?? 0),
    diameter_in: Number(b.diameter_in ?? 0),
    trench_width_ft: Number(b.trench_width_ft ?? 0),
    avg_depth_ft: Number(b.avg_depth_ft ?? 0),
    bedding_depth_in: b.bedding_depth_in != null ? Number(b.bedding_depth_in) : undefined,
    haunch_depth_in: b.haunch_depth_in != null ? Number(b.haunch_depth_in) : undefined,
    initial_backfill_over_pipe_in: b.initial_backfill_over_pipe_in != null ? Number(b.initial_backfill_over_pipe_in) : undefined,
    swell_factor: b.swell_factor != null ? Number(b.swell_factor) : undefined,
    shrink_factor: b.shrink_factor != null ? Number(b.shrink_factor) : undefined,
  };
}
