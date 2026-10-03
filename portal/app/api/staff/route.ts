import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

const TABLE = "staff_members";
const FIELDS = ["name", "role", "email", "phone", "hourly_rate", "project_role", "certifications", "assigned_at", "removed_at", "notes"] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: `[GET /api/staff] ${error.message}` }, { status: 500 });
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
    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const projectId = projectIdResult.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "admin", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insert: Record<string, any> = { tenant_id: tenantId, project_id: projectId };
    for (const k of FIELDS) insert[k] = body[k] ?? null;
    insert.name = String(body.name).trim();
    // certifications must be array or null
    if (insert.certifications != null && !Array.isArray(insert.certifications)) {
      insert.certifications = String(insert.certifications)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .insert(insert)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/staff] ${error.message}` }, { status: 422 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: TABLE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any).id,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
