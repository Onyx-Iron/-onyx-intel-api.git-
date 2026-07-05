import { NextRequest, NextResponse } from "next/server";
import { getPaddleConfig, verifyWebhookSignature } from "@/lib/billing/paddle";
import { getTenantBilling, setTenantBilling } from "@/lib/billing/tenantBilling";
import { PLANS } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanTier = "free" | "solo" | "crew" | "business";

function planTierFromPriceId(priceId: string): {
  plan_tier: PlanTier;
  ai_credits: number;
} | null {
  for (const [tier, def] of Object.entries(PLANS as Record<string, unknown>)) {
    if (!def || typeof def !== "object") continue;
    const d = def as {
      paddle_price_ids?: Record<string, string>;
      ai_credits_monthly?: number;
    };
    const ids = d.paddle_price_ids ?? {};
    if (Object.values(ids).includes(priceId)) {
      return {
        plan_tier: tier as PlanTier,
        ai_credits: d.ai_credits_monthly ?? 0,
      };
    }
  }
  return null;
}

function getStr(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function getObj(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function firstPriceId(data: Record<string, unknown>): string | undefined {
  const items = data.items;
  if (Array.isArray(items)) {
    for (const it of items) {
      const price = getObj(it, "price");
      const id = price ? getStr(price, "id") : getStr(it, "price_id");
      if (id) return id;
    }
  }
  return undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cfg = getPaddleConfig();
  if (!cfg) {
    // Webhook can't operate without secret; respond 503 (Paddle will retry,
    // but this only happens before initial configuration).
    return NextResponse.json(
      { error: "Billing is not configured", code: "BILLING_DISABLED" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("paddle-signature");
  if (!verifyWebhookSignature(signature, rawBody, cfg.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 200 });
  }

  const eventType = getStr(event, "event_type");
  const data = getObj(event, "data") ?? {};

  try {
    switch (eventType) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.activated": {
        const tenantId =
          getStr(getObj(data, "custom_data"), "tenant_id") ?? null;
        if (!tenantId) {
          console.warn("[paddle webhook] missing custom_data.tenant_id", {
            eventType,
          });
          break;
        }

        const paddleCustomerId = getStr(data, "customer_id") ?? null;
        const paddleSubscriptionId = getStr(data, "id") ?? null;
        const status = getStr(data, "status") ?? "active";

        // Tenant isolation: if tenant already has a paddle_customer_id, it must
        // match this event's customer_id — otherwise reject the cross-tenant
        // mapping. (Trust custom_data only when no prior chain exists.)
        const existing = await getTenantBilling(tenantId);
        if (
          existing?.paddle_customer_id &&
          paddleCustomerId &&
          existing.paddle_customer_id !== paddleCustomerId
        ) {
          console.error(
            "[paddle webhook] customer_id mismatch for tenant; ignoring",
            { tenantId },
          );
          break;
        }

        const priceId = firstPriceId(data);
        const tierInfo = priceId ? planTierFromPriceId(priceId) : null;
        if (!tierInfo) {
          console.warn("[paddle webhook] unknown price_id", { priceId });
          break;
        }

        const resetAt = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        await setTenantBilling(tenantId, {
          plan_tier: tierInfo.plan_tier,
          subscription_status: status,
          paddle_customer_id: paddleCustomerId,
          paddle_subscription_id: paddleSubscriptionId,
          ai_credits_remaining: tierInfo.ai_credits,
          ai_credits_reset_at: resetAt,
        });
        break;
      }

      case "subscription.canceled": {
        const tenantId =
          getStr(getObj(data, "custom_data"), "tenant_id") ?? null;
        if (!tenantId) break;

        const existing = await getTenantBilling(tenantId);
        const paddleCustomerId = getStr(data, "customer_id");
        if (
          existing?.paddle_customer_id &&
          paddleCustomerId &&
          existing.paddle_customer_id !== paddleCustomerId
        ) {
          console.error("[paddle webhook] customer_id mismatch on cancel", {
            tenantId,
          });
          break;
        }

        const period = getObj(data, "current_billing_period");
        const endsAtStr = period ? getStr(period, "ends_at") : null;
        const endsAt = endsAtStr ? new Date(endsAtStr).getTime() : null;
        const periodEnded = endsAt !== null && endsAt < Date.now();

        await setTenantBilling(tenantId, {
          subscription_status: "canceled",
          ...(periodEnded ? { plan_tier: "free" as PlanTier } : {}),
        });
        break;
      }

      case "subscription.paused":
      case "subscription.past_due": {
        const tenantId =
          getStr(getObj(data, "custom_data"), "tenant_id") ?? null;
        if (!tenantId) break;
        const status =
          eventType === "subscription.paused" ? "paused" : "past_due";
        await setTenantBilling(tenantId, { subscription_status: status });
        break;
      }

      case "transaction.completed": {
        console.log("[paddle webhook] transaction.completed", {
          id: getStr(data, "id"),
        });
        break;
      }

      default: {
        console.log("[paddle webhook] unhandled event", { eventType });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[paddle webhook] handler error", { eventType, msg });
    // Return 200 anyway so Paddle stops retrying; we've logged it.
  }

  return NextResponse.json({ received: true });
}
