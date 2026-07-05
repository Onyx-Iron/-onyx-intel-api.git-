import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { createTransactionCheckout, getPaddleConfig } from "@/lib/billing/paddle";
import { PLANS } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Plan = "solo" | "crew" | "business";
type Cycle = "monthly" | "yearly";

export async function POST(req: NextRequest): Promise<NextResponse> {
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

    const body = (await req.json()) as {
      plan?: string;
      billing_cycle?: string;
    };
    const plan = body.plan as Plan | undefined;
    const cycle = body.billing_cycle as Cycle | undefined;
    if (!plan || !["solo", "crew", "business"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    if (!cycle || !["monthly", "yearly"].includes(cycle)) {
      return NextResponse.json({ error: "Invalid billing_cycle" }, { status: 400 });
    }

    const planDef = (PLANS as Record<string, unknown>)[plan];
    if (!planDef || typeof planDef !== "object") {
      return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }
    const priceIds = (planDef as { paddle_price_ids?: Record<string, string> })
      .paddle_price_ids;
    const priceId = priceIds?.[cycle];
    if (!priceId) {
      return NextResponse.json(
        { error: `No Paddle price configured for ${plan}/${cycle}` },
        { status: 412 },
      );
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    if (!email) {
      return NextResponse.json(
        { error: "No email on file for user" },
        { status: 400 },
      );
    }

    const successUrl = `${req.nextUrl.origin}/dashboard/settings/billing?success=true`;

    const { url, transactionId } = await createTransactionCheckout({
      priceId,
      customerEmail: email,
      tenantId,
      userId,
      successUrl,
    });

    return NextResponse.json({ url, transaction_id: transactionId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[POST /api/billing/checkout] ${msg}` },
      { status: 500 },
    );
  }
}
