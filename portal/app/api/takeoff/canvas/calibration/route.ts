import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * Sheet calibration: pixels-to-real-world ratio for a single page.
 *
 * GET  ?page_id=... → returns current calibration (or null).
 * PUT  { page_id, scale_ratio, unit_type }
 *      → upserts. `scale_ratio` is real-units per pixel (e.g. 0.5 = each
 *      canvas pixel represents 0.5 ft). `unit_type` defaults to "LF".
 */

interface UpsertBody {
  page_id?: string;
  scale_ratio?: number;
  unit_type?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("sheet_calibrations")
    .select("id, page_id, scale_ratio, unit_type, updated_at")
    .eq("tenant_id", tenantId)
    .eq("page_id", pageId)
    .maybeSingle();

  return NextResponse.json({ calibration: data ?? null });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as UpsertBody;
  if (!body.page_id || typeof body.scale_ratio !== "number" || !Number.isFinite(body.scale_ratio) || body.scale_ratio <= 0) {
    return NextResponse.json({ error: "page_id and positive scale_ratio required" }, { status: 400 });
  }
  const unit_type = (body.unit_type ?? "LF").trim().toUpperCase();

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("sheet_calibrations")
    .upsert(
      {
        tenant_id: tenantId,
        page_id: body.page_id,
        scale_ratio: body.scale_ratio,
        unit_type,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "page_id" },
    )
    .select("id, page_id, scale_ratio, unit_type, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ calibration: data });
}
