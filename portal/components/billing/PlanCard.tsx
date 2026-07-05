"use client";

import { Check } from "lucide-react";
import type { PlanDef, PlanTier } from "@/lib/billing/plans";

interface PlanCardProps {
  plan: PlanDef;
  currentTier: PlanTier;
  billingCycle: "monthly" | "yearly";
  onSelect: (planKey: string, cycle: "monthly" | "yearly") => void;
}

function formatLimit(value: number, suffix: string): string {
  if (value === -1) return `Unlimited ${suffix}`;
  return `${value.toLocaleString()} ${suffix}`;
}

export default function PlanCard({
  plan,
  currentTier,
  billingCycle,
  onSelect,
}: PlanCardProps) {
  const isCurrent = currentTier === plan.tier;
  const isEnterprise = plan.tier === "enterprise";
  const isPopular = plan.tier === "crew";

  const priceLabel = (() => {
    if (plan.monthlyPriceUSD === "contact") return "Contact";
    if (plan.monthlyPriceUSD === 0) return "Free";
    if (billingCycle === "yearly") {
      // yearly = 2 months free → effective monthly price = monthly * 10 / 12
      const effective = Math.round((plan.monthlyPriceUSD * 10) / 12);
      return `$${effective}`;
    }
    return `$${plan.monthlyPriceUSD}`;
  })();

  const priceSuffix =
    plan.monthlyPriceUSD === "contact" || plan.monthlyPriceUSD === 0
      ? ""
      : "/mo";

  const yearlyHint =
    billingCycle === "yearly" &&
    typeof plan.monthlyPriceUSD === "number" &&
    plan.monthlyPriceUSD > 0
      ? `Billed $${plan.monthlyPriceUSD * 10}/yr`
      : null;

  const ctaLabel = isCurrent
    ? "Current Plan"
    : isEnterprise
      ? "Contact Sales"
      : plan.tier === "trial"
        ? "Continue Free Trial"
        : "Select Plan";

  const ctaDisabled = isCurrent;

  const handleClick = () => {
    if (isCurrent) return;
    if (isEnterprise) {
      window.location.href =
        "mailto:sales@onyx-iron.com?subject=OnyxIntel%20Enterprise%20Inquiry";
      return;
    }
    onSelect(plan.tier, billingCycle);
  };

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-[#0E0F12] p-6 ${
        isPopular
          ? "border-[#CCFF00]/40 ring-2 ring-[#CCFF00]/30"
          : "border-white/8"
      }`}
    >
      {isPopular && (
        <div className="absolute -top-3 left-6 inline-flex h-6 items-center rounded-full bg-[#CCFF00] px-3 text-[10px] font-bold uppercase tracking-widest text-black">
          Most Popular
        </div>
      )}

      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
          {plan.label}
        </p>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-4xl font-black tracking-tight text-white">
            {priceLabel}
          </span>
          {priceSuffix && (
            <span className="text-sm text-white/45">{priceSuffix}</span>
          )}
        </div>
        {yearlyHint && (
          <p className="mt-1 text-[11px] text-white/45">{yearlyHint}</p>
        )}
      </div>

      <ul className="mb-4 space-y-1.5 border-t border-white/5 pt-4 text-xs text-white/70">
        <li>{formatLimit(plan.seatLimit, "seats")}</li>
        <li>{formatLimit(plan.projectLimit, "projects")}</li>
        <li>{formatLimit(plan.aiCreditsPerMonth, "AI credits/mo")}</li>
      </ul>

      <ul className="mb-6 flex-1 space-y-2 text-xs text-white/60">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#CCFF00]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={handleClick}
        disabled={ctaDisabled}
        className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-4 text-xs font-bold uppercase tracking-widest transition-opacity ${
          ctaDisabled
            ? "cursor-not-allowed border border-white/10 bg-transparent text-white/40"
            : isPopular
              ? "bg-[#CCFF00] text-black hover:opacity-85"
              : "border border-white/15 bg-transparent text-white hover:bg-white/5"
        }`}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
