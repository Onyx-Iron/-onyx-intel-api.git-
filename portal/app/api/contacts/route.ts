import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const projectId = req.nextUrl.searchParams.get("project_id");
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);

    const db = await createServiceClient();
    let query = db
      .from("contacts")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/contacts] ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      contacts: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/contacts] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, company, role, email, phone, notes, project_id } = body as {
      name: string;
      company?: string;
      role?: string;
      email?: string;
      phone?: string;
      notes?: string;
      project_id?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (project_id !== undefined && project_id !== null && project_id !== "") {
      const pidParse = uuidSchema.safeParse(project_id);
      if (!pidParse.success) {
        return NextResponse.json({ error: "project_id must be a valid UUID" }, { status: 400 });
      }
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    if (project_id) {
      await assertProjectBelongsToTenant(project_id, tenantId);
    }

    const db = await createServiceClient();
    const { data, error } = await db
      .from("contacts")
      .insert({
        tenant_id:  tenantId,
        name:       name.trim(),
        company:    company ?? null,
        role:       role ?? null,
        email:      email ?? null,
        phone:      phone ?? null,
        notes:      notes ?? null,
        project_id: project_id ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: `[POST /api/contacts] ${error.message}` }, { status: 422 });
    }

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "contacts",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any)?.id,
      new_values: data as unknown as Record<string, unknown>,
    });

    if (project_id) {
      void logEvent({
        projectId: project_id,
        tenantId,
        userId,
        entityType: "contact",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entityId: (data as any)?.id,
        action: "created",
        title: `Contact created: ${name.trim().slice(0, 100)}`,
      });
    }

    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/contacts] ${msg}` }, { status: 500 });
  }
}
