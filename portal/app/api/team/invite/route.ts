import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { getTenantBilling } from "@/lib/billing/tenantBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "basic_member" | "admin";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json(
        {
          error:
            "You need an organization workspace to invite teammates. Create one in Clerk first.",
          code: "NO_ORG",
        },
        { status: 412 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      role?: Role;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const role: Role =
      body.role === "admin" ? "admin" : "basic_member";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Valid email is required", code: "INVALID_EMAIL" },
        { status: 400 },
      );
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    const denied = await requirePermission(tenantId, userId, "admin", "write");
    if (denied) return denied;

    const billing = await getTenantBilling(tenantId);
    const seatLimit = billing?.seat_limit ?? 1;

    const client = await clerkClient();

    // Count current org members for the seat check.
    const memberships =
      await client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100,
      });
    const currentCount = memberships.data.length;

    if (seatLimit !== -1 && currentCount >= seatLimit) {
      return NextResponse.json(
        {
          error: `Seat limit reached (${currentCount} of ${seatLimit}). Upgrade your plan to invite more teammates.`,
          code: "SEAT_LIMIT",
          current: currentCount,
          limit: seatLimit,
        },
        { status: 402 },
      );
    }

    // Verify caller is admin of the org.
    const callerMembership = memberships.data.find(
      (m) => m.publicUserData?.userId === userId,
    );
    if (!callerMembership || callerMembership.role !== "org:admin") {
      return NextResponse.json(
        { error: "Only org admins can invite teammates", code: "NOT_ADMIN" },
        { status: 403 },
      );
    }

    const clerkRole = role === "admin" ? "org:admin" : "org:member";

    const invitation =
      await client.organizations.createOrganizationInvitation({
        organizationId: orgId,
        emailAddress: email,
        role: clerkRole,
        inviterUserId: userId,
      });

    return NextResponse.json({ ok: true, invitation_id: invitation.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invite failed";
    return NextResponse.json(
      { error: message, code: "INVITE_FAILED" },
      { status: 500 },
    );
  }
}
