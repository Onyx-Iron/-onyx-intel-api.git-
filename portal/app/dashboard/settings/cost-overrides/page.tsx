import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { getTenantBilling } from "@/lib/billing/tenantBilling";
import { getPlan, type PlanTier } from "@/lib/billing/plans";
import PageHero from "@/components/layout/PageHero";
import CostOverrideManager from "./CostOverrideManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CostOverridesPage() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );

  const billing = await getTenantBilling(tenantId);
  const tier: PlanTier = billing?.plan_tier ?? "trial";
  const plan = getPlan(tier);

  return (
    <div>
      <PageHero
        eyebrow="Settings"
        title="Cost Overrides"
        description="Override regional unit prices with your supplier or historical pricing. These apply to all your projects."
      />
      <div className="px-4 py-8 lg:px-10">
        <CostOverrideManager tenantId={tenantId} planLabel={plan.label} />
      </div>
    </div>
  );
}
