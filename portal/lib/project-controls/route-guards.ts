/**
 * Shared API route guards — permission + ownership error mapping.
 * Keeps mutation handlers from re-copying the same try/catch boilerplate.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  assertPermission,
  PermissionError,
  type Action,
  type ResourceCategory,
  type RoleLookup,
} from "@/lib/project-controls/permissions";

type ClerkSessionForRole = {
  userId: string | null;
  orgId?: string | null;
  orgRole?: string | null;
};

async function readClerkSession(): Promise<ClerkSessionForRole> {
  const session = await auth();
  return {
    userId: session.userId,
    orgId: session.orgId,
    orgRole: session.orgRole,
  };
}

/**
 * Clerk org role for this request, used to recognize the workspace owner.
 * A session for a different user, or a Clerk failure, yields no role so the
 * caller cannot inherit someone else's org admin.
 */
export async function roleLookupFor(
  userId: string,
  readSession: () => Promise<ClerkSessionForRole> = readClerkSession,
): Promise<RoleLookup> {
  try {
    const session = await readSession();
    if (session.userId !== userId) return {};
    return { orgId: session.orgId, orgRole: session.orgRole };
  } catch {
    return {};
  }
}

/** Returns a 403 NextResponse when the role cannot perform the action; null when allowed. */
export async function requirePermission(
  tenantId: string,
  userId: string,
  resource: ResourceCategory,
  action: Action = "write",
): Promise<NextResponse | null> {
  try {
    await assertPermission(tenantId, userId, resource, action, await roleLookupFor(userId));
    return null;
  } catch (e) {
    if (e instanceof PermissionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

/** Map assertProjectBelongsToTenant / assertPageBelongsToProject failures to 403. */
export function ownershipDenied(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("does not belong")) {
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  return null;
}

/** True when a PostgREST/Postgres error looks like a unique-constraint violation. */
export function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}
