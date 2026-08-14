import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { getTenantBilling } from "@/lib/billing/tenantBilling";
import { getPlan, type PlanTier } from "@/lib/billing/plans";
import { getPaddleConfig } from "@/lib/billing/paddle";
import PageHero from "@/components/layout/PageHero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusBadge(tier: PlanTier, status: string | null, isComp: boolean) {
  if (isComp) {
    return {
      label: "Comp",
      classes: "bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/30",
    };
  }
  if (tier === "trial") {
    return {
      label: "Trial",
      classes: "bg-white/8 text-white/70 border-white/15",
    };
  }
  switch (status) {
    case "active":
      return {
        label: "Active",
        classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      };
    case "past_due":
      return {
        label: "Past Due",
        classes: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      };
    case "canceled":
      return {
        label: "Canceled",
        classes: "bg-red-500/15 text-red-300 border-red-500/30",
      };
    default:
      return {
        label: status ?? "Unknown",
        classes: "bg-white/8 text-white/70 border-white/15",
      };
  }
}
function formatLimit(value: number): string {
  return value === -1 ? "Unlimited" : value.toLocaleString();
}
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
export default async function BillingSettingsPage() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );

  const billing = await getTenantBilling(tenantId);
  const billingDisabled = !getPaddleConfig();
  const tier: PlanTier = billing?.plan_tier ?? "trial";
  const plan = getPlan(tier);

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const compUntilMs = billing?.comp_until
    ? new Date(billing.comp_until).getTime()
    : null;
  const isComp = compUntilMs !== null && compUntilMs > now;

  const badge = statusBadge(tier, billing?.subscription_status ?? null, isComp);
  const trialDays = tier === "trial" ? daysUntil(billing?.trial_ends_at ?? null) : null;

  const seatsUsed = billing?.seats_used ?? 0;
  const seatsTotal = billing?.seat_limit ?? plan.seatLimit;
  const aiTotal = plan.aiCreditsPerMonth;
  const aiRemaining = billing?.ai_credits_remaining ?? aiTotal;
  const aiUsed = aiTotal === -1 ? 0 : Math.max(0, aiTotal - aiRemaining);

  return (
    <div>
      <PageHero
        eyebrow="Settings"
        title="Billing"
        description="Manage your subscription, seats, and AI credits."
      />

      <div className="space-y-6 px-4 py-8 lg:px-10">
        {billingDisabled && (
          <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              Info
            </p>
            <p className="mt-2 text-sm text-white">
              Billing is not yet activated. You can keep using the workspace and finish setup now, then switch billing on once you&apos;re ready.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboard/projects"
                className="inline-flex h-9 items-center justify-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
              >
                Back to projects
              </Link>
              <Link
                href="/dashboard/settings/team"
                className="inline-flex h-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-4 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:border-white/30"
              >
                Team settings
              </Link>
            </div>
          </div>
        )}

        {/* Plan card */}
        <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                Current Plan
              </p>
              <div className="mt-2 flex items-center gap-3">
                <h2 className="text-3xl font-black tracking-tight text-white">
                  {plan.label}
                </h2>
                <span
                  className={`inline-flex h-6 items-center rounded-full border px-3 text-[10px] font-bold uppercase tracking-widest ${badge.classes}`}
                  aria-label={`Status: ${badge.label}`}
                >
                  {badge.label}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!billingDisabled && tier !== "trial" && tier !== "comp" && (
                <form action="/api/billing/portal" method="POST">
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
                  >
                    Manage Subscription
                  </button>
                </form>
              )}
              <Link
                href="/onboarding/plan"
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/5"
              >
                Change Plan
              </Link>
            </div>
          </div>

          {/* Trial banner */}
          {tier === "trial" && trialDays !== null && (
            <div className="mt-5 rounded-xl border border-[#CCFF00]/30 bg-[#CCFF00]/5 px-4 py-3 text-sm text-white">
              Your trial ends in <strong>{trialDays}</strong>{" "}
              {trialDays === 1 ? "day" : "days"}.
            </div>
          )}

          {/* Comp banner */}
          {isComp && (
            <div className="mt-5 rounded-xl border border-[#CCFF00]/30 bg-[#CCFF00]/5 px-4 py-3 text-sm text-white">
              Comp access - courtesy of Onyx & Iron · expires{" "}
              {billing?.comp_until
                ? new Date(billing.comp_until).toLocaleDateString()
                : "never"}
            </div>
          )}
        </div>

        {/* Limits */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              Seats
            </p>
            <p className="mt-3 text-2xl font-black text-white">
              {seatsUsed}
              <span className="text-base font-bold text-white/45">
                {" "}
                / {formatLimit(seatsTotal)}
              </span>
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              AI Credits (this month)
            </p>
            <p className="mt-3 text-2xl font-black text-white">
              {aiUsed.toLocaleString()}
              <span className="text-base font-bold text-white/45">
                {" "}
                / {formatLimit(aiTotal)}
              </span>
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              Projects
            </p>
            <p className="mt-3 text-2xl font-black text-white">
              <span className="text-base font-bold text-white/45">
                Limit:{" "}
              </span>
              {formatLimit(plan.projectLimit)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
