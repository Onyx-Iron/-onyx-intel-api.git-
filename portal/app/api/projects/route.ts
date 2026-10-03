import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";
import { parsePagination, paginationMeta } from "@/lib/pagination";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    // Default limit (200) matches every other list route's ceiling; kept high
    // so existing callers that don't pass ?page/?limit still see effectively
    // "all" projects for a normal tenant, while capping unbounded growth.
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 200);

    const db = await createServiceClient();
    const { data, error, count } = await db
      .from("projects")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json(
        { error: `[GET /api/projects] ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ projects: data ?? [], pagination: paginationMeta(count ?? 0, page, limit) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/projects] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, address, city, state, status, start_date, end_date, budget } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const payload: TablesInsert<"projects"> = {
      tenant_id: tenantId,
      name: name.trim(),
      address: address ?? null,
      city: city ?? null,
      state: state ?? null,
      status: status ?? "active",
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      budget: budget ?? null,
    };

    const db = await createServiceClient();
    const { data, error } = await db
      .from("projects")
      .insert(payload)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `[POST /api/projects] ${error.message}` },
        { status: 422 },
      );
    }

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "projects",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any).id,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ project: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/projects] ${msg}` }, { status: 500 });
  }
}
