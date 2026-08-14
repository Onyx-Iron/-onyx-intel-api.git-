import { NextRequest, NextResponse } from "next/server";
import { getPaddleConfig, verifyWebhookSignature } from "@/lib/billing/paddle";
import { getTenantBilling, setTenantBillingFromEvent } from "@/lib/billing/tenantBilling";
import { PLANS, type PlanTier } from "@/lib/billing/plans";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function planTierFromPriceId(priceId: string): {
  plan_tier: PlanTier;
  ai_credits: number;
} | null {
  for (const def of PLANS) {
    if (def.paddlePriceIdMonthly === priceId || def.paddlePriceIdYearly === priceId) {
      return {
        plan_tier: def.tier,
        ai_credits: def.aiCreditsPerMonth,
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

type EventClaim = "claimed" | "processed" | "busy";

async function claimEvent(eventId: string, eventType: string, occurredAt?: string): Promise<EventClaim> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = db.from("billing_webhook_events" as any);
  const now = new Date().toISOString();
  const { error: insertError } = await events.insert({
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt ?? null,
    status: "processing",
    updated_at: now,
  });
  if (!insertError) return "claimed";
  if (insertError.code !== "23505") throw new Error(`Could not claim billing event: ${insertError.message}`);

  const { data: existing, error: readError } = await events
    .select("status, attempts, updated_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (readError || !existing) throw new Error(`Could not read billing event: ${readError?.message ?? "missing"}`);
  const row = existing as unknown as { status: "processing" | "processed" | "failed"; attempts: number; updated_at: string };
  if (row.status === "processed") return "processed";

  const staleBefore = Date.now() - 5 * 60_000;
  const isStale = new Date(row.updated_at).getTime() < staleBefore;
  if (row.status === "processing" && !isStale) return "busy";

  const { data: reclaimed, error: reclaimError } = await events
    .update({
      status: "processing",
      attempts: Number(row.attempts ?? 1) + 1,
      last_error: null,
      updated_at: now,
    })
    .eq("event_id", eventId)
    .eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .select("event_id")
    .maybeSingle();
  if (reclaimError) throw new Error(`Could not reclaim billing event: ${reclaimError.message}`);
  return reclaimed ? "claimed" : "busy";
}

async function finishEvent(eventId: string, status: "processed" | "failed", error?: string): Promise<void> {
  const db = await createServiceClient();
  const now = new Date().toISOString();
  const { error: updateError } = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("billing_webhook_events" as any)
    .update({
      status,
      last_error: error?.slice(0, 2000) ?? null,
      updated_at: now,
      processed_at: status === "processed" ? now : null,
    })
    .eq("event_id", eventId);
  if (updateError) throw new Error(`Could not finish billing event: ${updateError.message}`);
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
  const eventId = getStr(event, "event_id") ?? getStr(event, "notification_id");
  const occurredAt = getStr(event, "occurred_at");
  if (!eventType || !eventId) {
    return NextResponse.json({ error: "Missing event identity" }, { status: 400 });
  }
  if (!occurredAt || !Number.isFinite(new Date(occurredAt).getTime())) {
    return NextResponse.json({ error: "Missing or invalid occurred_at" }, { status: 400 });
  }
  const data = getObj(event, "data") ?? {};

  try {
    const claim = await claimEvent(eventId, eventType, occurredAt);
    if (claim === "processed") return NextResponse.json({ received: true, duplicate: true });
    if (claim === "busy") {
      return NextResponse.json({ error: "Event is already processing" }, { status: 503, headers: { "Retry-After": "30" } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[paddle webhook] claim error", { eventType, eventId, msg });
    return NextResponse.json({ error: "Could not claim webhook event" }, { status: 503 });
  }

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

        await setTenantBillingFromEvent(tenantId, occurredAt, {
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

        await setTenantBillingFromEvent(tenantId, occurredAt, {
          subscription_status: "canceled",
          ...(periodEnded ? { plan_tier: "trial" as PlanTier } : {}),
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
        await setTenantBillingFromEvent(tenantId, occurredAt, { subscription_status: status });
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
    console.error("[paddle webhook] handler error", { eventType, eventId, msg });
    try {
      await finishEvent(eventId, "failed", msg);
    } catch (finishError) {
      console.error("[paddle webhook] failure-state write failed", finishError);
    }
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  try {
    await finishEvent(eventId, "processed");
  } catch (err) {
    console.error("[paddle webhook] completion write failed", { eventType, eventId, err });
    return NextResponse.json({ error: "Webhook completion was not recorded" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
