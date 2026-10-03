import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MemberOut {
  id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json({ members: [] });
    }

    const client = await clerkClient();
    const list = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });

    const members: MemberOut[] = list.data.map((m) => {
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

    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list members";
    return NextResponse.json(
      { error: message, code: "LIST_FAILED" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: "No organization", code: "NO_ORG" },
        { status: 412 },
      );
    }

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    const denied = await requirePermission(tenantId, userId, "admin", "write");
    if (denied) return denied;

    const body = (await req.json().catch(() => ({}))) as {
      membership_id?: string;
    };
    const membershipId = body.membership_id;
    if (!membershipId) {
      return NextResponse.json(
        { error: "membership_id required", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const client = await clerkClient();

    // Verify caller is org admin.
    const list = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });
    const caller = list.data.find(
      (m) => m.publicUserData?.userId === userId,
    );
    if (!caller || caller.role !== "org:admin") {
      return NextResponse.json(
        { error: "Only org admins can remove members", code: "NOT_ADMIN" },
        { status: 403 },
      );
    }

    const target = list.data.find((m) => m.id === membershipId);
    if (!target) {
      return NextResponse.json(
        { error: "Membership not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    await client.organizations.deleteOrganizationMembership({
      organizationId: orgId,
      userId: target.publicUserData?.userId ?? "",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove";
    return NextResponse.json(
      { error: message, code: "REMOVE_FAILED" },
      { status: 500 },
    );
  }
}
