import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface OverrideUpdate {
  cost_code?: string;
  region_code?: string | null;
  unit_cost?: number;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  notes?: string | null;
}

function validOptionalCost(value: unknown): value is number | null | undefined {
  return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

async function financialTenant(): Promise<{ tenantId: string; userId: string }> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) {
    const error = new Error("Unauthorized") as Error & { status: number };
    error.status = 401;
    throw error;
  }
  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );
  await assertPermission(tenantId, userId, "financial", "write");
  return { tenantId, userId };
}

function failure(error: unknown): NextResponse {
  const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export async function PATCH(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { tenantId } = await financialTenant();
    const body = await req.json() as OverrideUpdate;

    if (!validOptionalCost(body.unit_cost)
      || !validOptionalCost(body.labor_cost)
      || !validOptionalCost(body.material_cost)
      || !validOptionalCost(body.equipment_cost)) {
      return NextResponse.json({ error: "Cost values must be non-negative finite numbers" }, { status: 400 });
    }
    if (body.unit_cost === undefined) {
      return NextResponse.json({ error: "unit_cost is required" }, { status: 400 });
    }

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: existing, error: existingError } = await anyDb
      .from("cost_overrides")
      .select("id,cost_code_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: "Cost override not found" }, { status: 404 });

    let costCodeId = existing.cost_code_id as string;
    if (body.cost_code) {
      const { data: code, error: codeError } = await anyDb
        .from("cost_codes")
        .select("id")
        .eq("csi_code", body.cost_code.trim())
        .maybeSingle();
      if (codeError) throw codeError;
      if (!code) return NextResponse.json({ error: `Unknown cost_code: ${body.cost_code}` }, { status: 404 });
      costCodeId = code.id as string;
    }

    const { data, error } = await anyDb
      .from("cost_overrides")
      .update({
        cost_code_id: costCodeId,
        region_code: body.region_code?.trim() || null,
        unit_cost: body.unit_cost,
        labor_cost: body.labor_cost ?? null,
        material_cost: body.material_cost ?? null,
        equipment_cost: body.equipment_cost ?? null,
        notes: body.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*, cost_codes(csi_code,description,uom)")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ item: data });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { tenantId } = await financialTenant();
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("cost_overrides")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Cost override not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
