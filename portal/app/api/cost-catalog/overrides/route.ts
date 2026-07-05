import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tenant(): Promise<{ tenantId: string } | NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );
  return { tenantId };
}

export async function GET(): Promise<NextResponse> {
  try {
    const t = await tenant();
    if (t instanceof NextResponse) return t;
    const db = await createServiceClient();
    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_overrides" as any)
      .select("*, cost_codes(csi_code, description, uom)")
      .eq("tenant_id", t.tenantId)
      .order("updated_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface OverrideBody {
  cost_code?: string;
  cost_code_id?: string;
  region_code?: string | null;
  unit_cost: number;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  notes?: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const t = await tenant();
    if (t instanceof NextResponse) return t;
    const body = (await req.json()) as OverrideBody;
    if (
      typeof body.unit_cost !== "number" ||
      !isFinite(body.unit_cost) ||
      body.unit_cost < 0
    ) {
      return NextResponse.json(
        { error: "unit_cost must be a non-negative number" },
        { status: 400 },
      );
    }
    if (!body.cost_code && !body.cost_code_id) {
      return NextResponse.json(
        { error: "cost_code or cost_code_id required" },
        { status: 400 },
      );
    }

    const db = await createServiceClient();
    let costCodeId = body.cost_code_id;
    if (!costCodeId && body.cost_code) {
      const { data: codeRow, error: codeErr } = await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("cost_codes" as any)
        .select("id")
        .eq("csi_code", body.cost_code)
        .maybeSingle();
      if (codeErr) {
        return NextResponse.json({ error: codeErr.message }, { status: 500 });
      }
      if (!codeRow) {
        return NextResponse.json(
          { error: `Unknown cost_code: ${body.cost_code}` },
          { status: 404 },
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      costCodeId = (codeRow as any).id as string;
    }

    const payload = {
      tenant_id: t.tenantId,
      cost_code_id: costCodeId,
      region_code: body.region_code ?? null,
      unit_cost: body.unit_cost,
      labor_cost: body.labor_cost ?? null,
      material_cost: body.material_cost ?? null,
      equipment_cost: body.equipment_cost ?? null,
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_overrides" as any)
      .upsert(payload, {
        onConflict: "tenant_id,cost_code_id,region_code",
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const t = await tenant();
    if (t instanceof NextResponse) return t;
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const db = await createServiceClient();
    const { error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_overrides" as any)
      .delete()
      .eq("id", id)
      .eq("tenant_id", t.tenantId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
