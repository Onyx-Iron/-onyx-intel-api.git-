import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { getPaddleConfig } from "@/lib/billing/paddle";
import { getTenantBilling } from "@/lib/billing/tenantBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );

    const billing = await getTenantBilling(tenantId);
    const paddleConfigured = !!getPaddleConfig();

    const now = Date.now();

    const trialEndsAtStr =
      billing && "trial_ends_at" in billing
        ? (billing as { trial_ends_at?: string | null }).trial_ends_at ?? null
        : null;
    const trialEndsAt = trialEndsAtStr ? new Date(trialEndsAtStr).getTime() : null;
    const trialDaysRemaining =
      trialEndsAt !== null
        ? Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)))
        : 0;

    const compUntilStr =
      billing && "comp_until" in billing
        ? (billing as { comp_until?: string | null }).comp_until ?? null
        : null;
    const compUntil = compUntilStr ? new Date(compUntilStr).getTime() : null;
    const isComp = compUntil !== null && compUntil > now;

    return NextResponse.json({
      billing: billing ?? null,
      trial_days_remaining: trialDaysRemaining,
      is_comp: isComp,
      paddle_configured: paddleConfigured,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[GET /api/billing/status] ${msg}` },
      { status: 500 },
    );
  }
}
