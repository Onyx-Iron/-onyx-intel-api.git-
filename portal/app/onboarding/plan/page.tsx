"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHero from "@/components/layout/PageHero";
import PlanCard from "@/components/billing/PlanCard";
import { PLANS, type PlanTier } from "@/lib/billing/plans";

type Cycle = "monthly" | "yearly";

interface StatusResponse {
  billing: { plan_tier?: PlanTier; subscription_status?: string | null } | null;
  is_comp?: boolean;
}

const PAID_TIERS: PlanTier[] = ["solo", "crew", "business", "enterprise"];

export default function OnboardingPlanPage() {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [currentTier, setCurrentTier] = useState<PlanTier>("trial");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const json = (await res.json()) as StatusResponse;
        if (!active) return;
        const tier: PlanTier = json.billing?.plan_tier ?? "trial";
        setCurrentTier(tier);
        if (
          (json.billing?.subscription_status === "active" &&
            PAID_TIERS.includes(tier)) ||
          json.is_comp
        ) {
          router.replace("/dashboard");
          return;
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const handleSelect = async (planKey: string, billingCycle: Cycle) => {
    setError(null);
    if (planKey === "trial") {
      router.push("/dashboard");
      return;
    }
    setSubmitting(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: planKey, cycle: billingCycle }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Checkout failed (${res.status})`);
      }
      const json = (await res.json()) as { url?: string };
      if (json.url) {
        window.location.href = json.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#06070A]">
      <PageHero
        eyebrow="Onboarding"
        title="Pick your plan"
        description="Start free, upgrade anytime. Yearly billing saves 17%."
      />
      <div className="px-4 py-8 lg:px-10">
        <div className="mb-6 flex items-center justify-center">
          <div className="inline-flex rounded-full border border-white/8 bg-[#0E0F12] p-1">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`h-8 rounded-full px-4 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                cycle === "monthly"
                  ? "bg-[#CCFF00] text-black"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("yearly")}
              className={`h-8 rounded-full px-4 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                cycle === "yearly"
                  ? "bg-[#CCFF00] text-black"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Yearly · 2 months free
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-auto mb-6 max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center text-sm text-white/45">Loading plans…</p>
        ) : (
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {PLANS.filter((p) => p.tier !== "comp").map((plan) => (
              <div
                key={plan.tier}
                className={
                  submitting === plan.tier ? "pointer-events-none opacity-60" : ""
                }
              >
                <PlanCard
                  plan={plan}
                  currentTier={currentTier}
                  billingCycle={cycle}
                  onSelect={handleSelect}
                />
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-white/45">
          Need a custom setup?{" "}
          <a
            href="mailto:sales@onyx-iron.com"
            className="text-[#CCFF00] hover:underline"
          >
            Talk to sales
          </a>
        </p>
      </div>
    </div>
  );
}
