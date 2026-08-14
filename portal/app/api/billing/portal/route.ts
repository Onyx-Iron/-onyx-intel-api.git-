import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { createCustomerPortalSession, getPaddleConfig } from "@/lib/billing/paddle";
import { getTenantBilling } from "@/lib/billing/tenantBilling";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    if (!getPaddleConfig()) {
      return NextResponse.json(
        { error: "Billing is not configured", code: "BILLING_DISABLED" },
        { status: 503 },
      );
    }

    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "admin", "write");

    const billing = await getTenantBilling(tenantId);
    const paddleCustomerId = billing?.paddle_customer_id ?? null;
    if (!paddleCustomerId) {
      return NextResponse.json(
        { error: "No active subscription", code: "NO_SUBSCRIPTION" },
        { status: 412 },
      );
    }

    const { url } = await createCustomerPortalSession({
      paddleCustomerId,
      subscriptionId: billing?.paddle_subscription_id ?? undefined,
    });

    return NextResponse.json({ url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[POST /api/billing/portal] ${msg}` },
      { status: err instanceof PermissionError ? 403 : 500 },
    );
  }
}
