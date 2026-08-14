import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { seedStarterCostCatalog } from "@/lib/cost/starter-catalog";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

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
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();
    const seeded = await seedStarterCostCatalog(db, tenantId);

    if (seeded === 0) {
      return NextResponse.json({ seeded: 0, message: "Catalog already has entries. Clear existing rates first or add items manually." });
    }
    return NextResponse.json({ seeded }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
