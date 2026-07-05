import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildEstimateImportRows } from "@/lib/estimating/takeoff-import";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { project_id?: string };
    if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const [takeoff, existing, catalog] = await Promise.all([
      anyDb
        .from("takeoff_items")
        .select("id,label,csi_code,division,quantity,unit,type,meta")
        .eq("tenant_id", tenantId)
        .eq("project_id", body.project_id)
        .order("created_at", { ascending: true }),
      anyDb
        .from("estimate_items")
        .select("source_takeoff_id,source_fingerprint,notes")
        .eq("tenant_id", tenantId)
        .eq("project_id", body.project_id),
      anyDb
        .from("cost_catalog")
        .select("csi_code,uom,unit_cost")
        .eq("tenant_id", tenantId),
    ]);

    if (takeoff.error) return NextResponse.json({ error: `[takeoff] ${takeoff.error.message}` }, { status: 500 });
    if (existing.error) return NextResponse.json({ error: `[estimate] ${existing.error.message}` }, { status: 500 });
    if (catalog.error) return NextResponse.json({ error: `[cost_catalog] ${catalog.error.message}` }, { status: 500 });

    const result = buildEstimateImportRows({
      takeoffItems: takeoff.data ?? [],
      existingEstimateItems: existing.data ?? [],
      costCatalog: catalog.data ?? [],
      projectId: body.project_id,
    });

    if (result.rows.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: result.skipped,
        priced: 0,
        unpriced: 0,
        review: 0,
        items: [],
      });
    }

    const payload = result.rows.map((row) => ({
      ...row,
      tenant_id: tenantId,
    }));

    const { data, error } = await anyDb
      .from("estimate_items")
      .insert(payload)
      .select();

    if (error) return NextResponse.json({ error: `[import-takeoff] ${error.message}` }, { status: 422 });

    return NextResponse.json({
      imported: data?.length ?? 0,
      skipped: result.skipped,
      priced: result.rows.filter((row) => row.pricing_status === "priced").length,
      unpriced: result.rows.filter((row) => row.pricing_status === "unpriced").length,
      review: result.rows.filter((row) => row.pricing_status === "review").length,
      items: data ?? [],
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/estimate/import-takeoff] ${msg}` }, { status: 500 });
  }
}
