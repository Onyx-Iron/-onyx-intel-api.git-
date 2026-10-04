import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { getUserRole } from "@/lib/project-controls/permissions";
import { redactCostActualRows } from "@/lib/project-controls/financial-redaction";
import { auditInsert } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActualBody {
  project_id?: string;
  csi_code?: string;
  actual_unit_cost?: number;
  estimated_unit_cost?: number | null;
  quantity?: number | null;
  source?: string | null;
  observed_at?: string;
  notes?: string | null;
  region_code?: string | null;
}

// POST /api/cost-catalog/actuals — tenant-isolated actual cost capture for
// calibration. Resolves cost_code_id when possible and derives region_code
// from the project's state if not provided.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const body = (await req.json()) as ActualBody;
    if (!body.project_id) {
      return NextResponse.json(
        { error: "project_id required" },
        { status: 400 },
      );
    }
    if (!body.csi_code) {
      return NextResponse.json(
        { error: "csi_code required" },
        { status: 400 },
      );
    }
    if (
      typeof body.actual_unit_cost !== "number" ||
      !isFinite(body.actual_unit_cost)
    ) {
      return NextResponse.json(
        { error: "actual_unit_cost must be a number" },
        { status: 400 },
      );
    }

    try {
      await assertProjectBelongsToTenant(body.project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const db = await createServiceClient();

    // Pull region from the verified project
    const { data: project, error: projErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("projects" as any)
      .select("id, tenant_id, zip_code")
      .eq("id", body.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (projErr) {
      return NextResponse.json({ error: projErr.message }, { status: 500 });
    }
    if (!project) {
      return NextResponse.json(
        { error: "project not found" },
        { status: 404 },
      );
    }

    // Resolve cost_code_id (best-effort)
    const { data: codeRow } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_codes" as any)
      .select("id")
      .eq("csi_code", body.csi_code)
      .maybeSingle();

    const payload = {
      tenant_id: tenantId,
      project_id: body.project_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cost_code_id: (codeRow as any)?.id ?? null,
      csi_code: body.csi_code,
      region_code:
        body.region_code ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (project as any).zip_code ??
        null,
      estimated_unit_cost: body.estimated_unit_cost ?? null,
      actual_unit_cost: body.actual_unit_cost,
      quantity: body.quantity ?? null,
      observed_at: body.observed_at ?? new Date().toISOString().slice(0, 10),
      source: body.source ?? "closeout",
      notes: body.notes ?? null,
    };

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_actuals" as any)
      .insert(payload)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "cost_actuals",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: String((data as any)?.id ?? body.project_id),
      new_values: data as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/cost-catalog/actuals?csi_code=03-30-00 — list this tenant's actuals
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    const db = await createServiceClient();
    const csi = req.nextUrl.searchParams.get("csi_code");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (db.from("cost_actuals" as any) as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("observed_at", { ascending: false })
      .limit(200);
    if (csi) q = q.eq("csi_code", csi);
    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const role = await getUserRole(tenantId, userId);
    const items = redactCostActualRows((data ?? []) as Record<string, unknown>[], role);
    return NextResponse.json({ items });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
