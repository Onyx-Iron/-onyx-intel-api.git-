import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";

// ── Operational roles (mirrors the CHECK constraint on project_profiles.role) ──
export type Role =
  | "Owner"
  | "Admin"
  | "Estimator"
  | "ProjectManager"
  | "FieldSuperintendent"
  | "Subcontractor"
  | "ClientView";

const KNOWN_ROLES: readonly Role[] = [
  "Owner", "Admin", "Estimator", "ProjectManager", "FieldSuperintendent", "Subcontractor", "ClientView",
];

const DEFAULT_ROLE: Role = "ClientView";

interface RoleIdentity {
  requestedUserId: string;
  authenticatedUserId: string | null;
  orgId: string | null;
  orgRole: string | null;
}

export function fallbackRoleForIdentity(identity: RoleIdentity): Role {
  if (!identity.authenticatedUserId || identity.authenticatedUserId !== identity.requestedUserId) {
    return DEFAULT_ROLE;
  }
  if (!identity.orgId) return "Owner";
  return identity.orgRole === "org:admin" ? "Admin" : DEFAULT_ROLE;
}

// ── Resource categories the app currently gates ──
export type ResourceCategory = "financial" | "field" | "admin";
export type Action = "read" | "write";

// Roles that may WRITE to a given resource category. Read access is implied
// for every role except where noted — ClientView and Subcontractor still get
// read access to `field` (drawings, RFIs, daily logs) so they can follow
// project progress; only `financial` write is restricted per the pricing
// view-state rules in EstimateMatrix.
const WRITE_MATRIX: Record<ResourceCategory, ReadonlySet<Role>> = {
  financial: new Set(["Owner", "Admin", "Estimator", "ProjectManager"]),
  field:     new Set(["Owner", "Admin", "Estimator", "ProjectManager", "FieldSuperintendent", "Subcontractor"]),
  admin:     new Set(["Owner", "Admin"]),
};

// ClientView never writes anything, regardless of category.
const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["ClientView"]);

export class PermissionError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/** Looks up the caller's operational role for a tenant, defaulting if unset. */
export async function getUserRole(tenantId: string, clerkUserId: string): Promise<Role> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data } = await anyDb
    .from("project_profiles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const role = data?.role as string | undefined;
  if (role && (KNOWN_ROLES as readonly string[]).includes(role)) return role as Role;

  let fallback = DEFAULT_ROLE;
  try {
    const identity = await auth();
    fallback = fallbackRoleForIdentity({
      requestedUserId: clerkUserId,
      authenticatedUserId: identity.userId,
      orgId: identity.orgId ?? null,
      orgRole: identity.orgRole ?? null,
    });
  } catch {
    // Outside a request context or when Clerk is unavailable, fail closed.
  }

  const { error } = await anyDb.from("project_profiles").upsert({
    tenant_id: tenantId,
    clerk_user_id: clerkUserId,
    role: fallback,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,clerk_user_id", ignoreDuplicates: true });
  if (error) throw new Error(`Unable to persist operational role: ${error.message}`);
  return fallback;
}

// Financial-read gate (frontend-backend-reconciliation, item 4). Every role
// could previously READ financial data — only writes were gated — which
// meant a ClientView or Subcontractor caller could pull unit_cost,
// labor_cost, markup, profit, and invoice amounts through any route that
// didn't add its own extra check. Read access to `financial` now mirrors
// write access to it: only the roles that can price/quote a project
// (Owner/Admin/Estimator/ProjectManager) can see the numbers at all.
// `field`/`admin` reads are unchanged (still universal) — this only
// tightens the one category the master prompt called out explicitly.
export function canPerform(role: Role, resource: ResourceCategory, action: Action): boolean {
  if (READ_ONLY_ROLES.has(role) && action === "write") return false;
  if (resource === "financial") return WRITE_MATRIX.financial.has(role);
  if (action === "read") return true;
  return WRITE_MATRIX[resource].has(role);
}

/** True if this role may see financial values (cost/markup/profit/invoice amounts) at all — used to redact fields server-side, not just hide UI. */
export function canReadFinancial(role: Role): boolean {
  return canPerform(role, "financial", "read");
}

/**
 * Nulls out the given field names on every row when the caller's role
 * cannot read financial data — applied server-side, in the API route,
 * BEFORE the response is sent. This is what makes the restriction real
 * rather than cosmetic: a restricted role never receives the values in the
 * JSON payload at all, regardless of what the client does with them.
 */
export function redactFinancialFields<T extends Record<string, unknown>>(
  rows: T[],
  role: Role,
  fields: readonly string[],
): T[] {
  if (canReadFinancial(role)) return rows;
  return rows.map((row) => {
    const redacted = { ...row };
    for (const field of fields) {
      if (field in redacted) (redacted as Record<string, unknown>)[field] = null;
    }
    return redacted;
  });
}

/**
 * Intercepts a modification (INSERT/UPDATE/DELETE) before it reaches the
 * database. Throws `PermissionError` (map to HTTP 403 in the route handler)
 * if the caller's role isn't allowed to write to the given resource.
 */
export async function assertPermission(
  tenantId: string,
  clerkUserId: string,
  resource: ResourceCategory,
  action: Action,
): Promise<Role> {
  const role = await getUserRole(tenantId, clerkUserId);
  if (!canPerform(role, resource, action)) {
    throw new PermissionError(`Role '${role}' is not permitted to ${action} ${resource} resources.`);
  }
  return role;
}

/** Checks a permission while preserving infrastructure failures for the caller to surface. */
export async function hasPermission(
  tenantId: string,
  clerkUserId: string,
  resource: ResourceCategory,
  action: Action,
): Promise<boolean> {
  return canPerform(await getUserRole(tenantId, clerkUserId), resource, action);
}
