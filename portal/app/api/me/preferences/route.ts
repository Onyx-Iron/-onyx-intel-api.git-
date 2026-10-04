import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { emptyFirstRun, parseFirstRun, type FirstRunFlags } from "@/lib/onboarding/firstRun";

export const runtime = "nodejs";

/**
 * GET /api/me/preferences
 * PATCH /api/me/preferences  { first_run?: Partial<FirstRunFlags> }
 *
 * Server copy of the first-run checklist so a new device picks up progress.
 * localStorage remains the client cache; the portal syncs on load and patch.
 */
export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // Table added in 20261011000000_user_preferences — not yet in generated Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("user_preferences")
    .select("first_run")
    .eq("tenant_id", tenantId)
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const first_run = data?.first_run
    ? parseFirstRun(JSON.stringify(data.first_run))
    : emptyFirstRun();
  return NextResponse.json({ first_run });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { first_run?: Partial<FirstRunFlags> };
  if (!body.first_run || typeof body.first_run !== "object") {
    return NextResponse.json({ error: "first_run patch object is required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (db as any)
    .from("user_preferences")
    .select("first_run")
    .eq("tenant_id", tenantId)
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });

  const current = existing.data?.first_run
    ? parseFirstRun(JSON.stringify(existing.data.first_run))
    : emptyFirstRun();
  const next: FirstRunFlags = {
    ...current,
    ...Object.fromEntries(
      Object.entries(body.first_run).filter(([, v]) => typeof v === "boolean"),
    ) as Partial<FirstRunFlags>,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("user_preferences")
    .upsert(
      {
        tenant_id: tenantId,
        clerk_user_id: userId,
        first_run: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,clerk_user_id" },
    )
    .select("first_run")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    first_run: parseFirstRun(JSON.stringify(data.first_run)),
  });
}
