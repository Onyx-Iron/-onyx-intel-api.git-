import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { setCompUntil } from "@/lib/billing/tenantBilling";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "justinatteberry@onyx-iron.com";
// Sentinel for "comp forever" — far-future timestamp.
const FOREVER_DATE = new Date("9999-12-31T00:00:00.000Z");

async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  if (email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId };
}

interface PostBody {
  tenant_id?: string;
  tenant_query?: string;
  comp_until: string | null | "forever";
}

async function resolveTenantId(
  body: PostBody,
): Promise<{ id: string } | { error: string; status: number }> {
  const db = await createServiceClient();
  if (body.tenant_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db.from("tenants") as any)
      .select("id")
      .eq("id", body.tenant_id)
      .maybeSingle();
    if (!data) return { error: "Tenant not found", status: 404 };
    return { id: data.id as string };
  }

  if (body.tenant_query) {
    const q = body.tenant_query.trim();
    // Try name match first, then clerk_org_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: byName } = await (db.from("tenants") as any)
      .select("id")
      .eq("name", q)
      .maybeSingle();
    if (byName?.id) return { id: byName.id as string };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: byOrg } = await (db.from("tenants") as any)
      .select("id")
      .eq("clerk_org_id", q)
      .maybeSingle();
    if (byOrg?.id) return { id: byOrg.id as string };

    return { error: "Tenant not found by name or org slug", status: 404 };
  }

  return { error: "tenant_id or tenant_query required", status: 400 };
}

export async function GET(): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db.from("tenants") as any)
      .select("id, name, clerk_org_id, comp_until")
      .not("comp_until", "is", null);

    if (error) {
      return NextResponse.json(
        { error: `[GET /api/admin/comp-access] ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ tenants: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[GET /api/admin/comp-access] ${msg}` },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const callerTenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(callerTenantId, userId, "admin", "write");
    if (denied) return denied;

    const body = (await req.json()) as PostBody;
    const resolved = await resolveTenantId(body);
    if ("error" in resolved) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status },
      );
    }

    let until: Date | null;
    if (body.comp_until === null) {
      until = null;
    } else if (body.comp_until === "forever") {
      until = FOREVER_DATE;
    } else {
      const d = new Date(body.comp_until);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid comp_until date" },
          { status: 400 },
        );
      }
      until = d;
    }

    await setCompUntil(resolved.id, until);
    auditUpdate({
      tenant_id: callerTenantId,
      user_id: admin.userId,
      table_name: "tenants",
      record_id: resolved.id,
      old_values: null,
      new_values: { comp_until: until?.toISOString() ?? null } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true, tenant_id: resolved.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[POST /api/admin/comp-access] ${msg}` },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const callerTenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(callerTenantId, userId, "admin", "write");
    if (denied) return denied;

    const body = (await req.json()) as { tenant_id?: string };
    if (!body.tenant_id) {
      return NextResponse.json(
        { error: "tenant_id required" },
        { status: 400 },
      );
    }

    await setCompUntil(body.tenant_id, null);
    auditUpdate({
      tenant_id: callerTenantId,
      user_id: admin.userId,
      table_name: "tenants",
      record_id: body.tenant_id,
      old_values: null,
      new_values: { comp_until: null } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[DELETE /api/admin/comp-access] ${msg}` },
      { status: 500 },
    );
  }
}
