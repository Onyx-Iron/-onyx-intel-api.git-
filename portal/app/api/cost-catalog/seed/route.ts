import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";
import { seedStarterCostCatalog } from "@/lib/cost/starter-catalog";

export const runtime = "nodejs";

// New tenants are auto-seeded on creation (see getOrCreateTenant), so this
// route is now mainly a manual "re-seed" escape hatch — e.g. a tenant that
// cleared its catalog and wants the starter rates back. seedStarterCostCatalog
// is a no-op if the catalog already has rows.
export async function POST(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await createServiceClient();
    const seeded = await seedStarterCostCatalog(db, tenantId);

    if (seeded === 0) {
      return NextResponse.json({ seeded: 0, message: "Catalog already has entries. Clear existing rates first or add items manually." });
    }

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "cost_catalog",
      record_id: tenantId,
      new_values: { seeded } as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ seeded }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
