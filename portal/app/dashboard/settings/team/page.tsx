import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { getTenantBilling } from "@/lib/billing/tenantBilling";
import PageHero from "@/components/layout/PageHero";
import TeamManager from "./TeamManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}

export default async function TeamSettingsPage() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );
  const billing = await getTenantBilling(tenantId);
  const seatLimit = billing?.seat_limit ?? 1;

  let members: MemberRow[] = [];
  let isAdmin = false;

  if (orgId) {
    const client = await clerkClient();
    const list = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });
    members = list.data.map((m) => {
      const pub = m.publicUserData;
      const first = pub?.firstName ?? "";
      const last = pub?.lastName ?? "";
      const name = `${first} ${last}`.trim() || pub?.identifier || "Unknown";
      return {
        id: m.id,
        email: pub?.identifier ?? "",
        name,
        role: m.role,
        joined_at: new Date(m.createdAt).toISOString(),
      };
    });
    const caller = list.data.find((m) => m.publicUserData?.userId === userId);
    isAdmin = caller?.role === "org:admin";
  }

  const seatsUsed = members.length;
  const atLimit = seatLimit !== -1 && seatsUsed >= seatLimit;
  const limitDisplay = seatLimit === -1 ? "unlimited" : seatLimit;

  return (
    <div>
      <PageHero
        eyebrow="Settings"
        title="Team"
        description="Manage who has access to this workspace"
      />

      <div className="space-y-6 px-4 py-8 lg:px-10">
        {!orgId && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
              Personal Workspace
            </p>
            <p className="mt-2 text-sm text-white">
              Team invites require an organization workspace. Visit your Clerk
              dashboard to create one.
            </p>
          </div>
        )}

        {atLimit && orgId && (
          <div className="rounded-2xl border border-[#CCFF00]/30 bg-[#CCFF00]/5 p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]">
              Seat Limit Reached
            </p>
            <p className="mt-2 text-sm text-white">
              You&apos;re using {seatsUsed} of {limitDisplay} seats.{" "}
              <Link
                href="/onboarding/plan"
                className="font-bold text-[#CCFF00] underline"
              >
                Upgrade your plan
              </Link>{" "}
              to add more teammates.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
            Seat Usage
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {seatsUsed} of {limitDisplay} seats used
          </p>
        </div>

        {orgId && (
          <TeamManager
            initialMembers={members}
            isAdmin={isAdmin}
            atLimit={atLimit}
          />
        )}
      </div>
    </div>
  );
}
