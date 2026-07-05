import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

const TABLE = "lien_waivers";
const FIELDS = [
  "vendor_name", "waiver_type", "draw_number", "amount", "through_date",
  "state", "document_id", "signed_at", "signed_by", "status", "notes",
] as const;

const VALID_STATUSES = new Set(["pending", "received", "expired"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });
    const status = req.nextUrl.searchParams.get("status");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(TABLE as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);
    if (status && VALID_STATUSES.has(status)) q = q.eq("status", status);

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: `[GET /api/lien-waivers] ${error.message}` }, { status: 500 });
    return NextResponse.json({ items: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;
    const projectIdResult = uuidSchema.safeParse(body.project_id);
    if (!projectIdResult.success) return NextResponse.json({ error: "project_id: Invalid UUID" }, { status: 400 });

    const vendor = typeof body.vendor_name === "string" ? body.vendor_name.trim() : "";
    if (!vendor) return NextResponse.json({ error: "vendor_name is required" }, { status: 400 });

    const waiver = typeof body.waiver_type === "string" && body.waiver_type.trim() ? body.waiver_type.trim() : "conditional_progress";
    const status = typeof body.status === "string" ? body.status : "pending";
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `status must be one of ${[...VALID_STATUSES].join(", ")}` }, { status: 400 });
    }

    const projectId = projectIdResult.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insert: Record<string, any> = { tenant_id: tenantId, project_id: projectId };
    for (const k of FIELDS) insert[k] = body[k] ?? null;
    insert.vendor_name = vendor;
    insert.waiver_type = waiver;
    insert.status = status;

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .insert(insert)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/lien-waivers] ${error.message}` }, { status: 422 });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
