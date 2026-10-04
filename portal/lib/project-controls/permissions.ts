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

// A member with no project_profiles row is an Estimator: they can estimate
// and work the job, and they cannot delete the workspace's projects.
// The workspace owner is resolved separately and is always Owner.
const DEFAULT_ROLE: Role = "Estimator";

export interface RoleLookup {
  orgId?: string | null;
  orgRole?: string | null;
}

/** Clerk organization administrators, plus the person who owns a personal workspace. */
export function isWorkspaceOwner(input: {
  clerkUserId: string;
  clerkOrgId: string | null | undefined;
  orgId?: string | null;
  orgRole?: string | null;
}): boolean {
  if (input.clerkOrgId != null && input.clerkOrgId === `user_${input.clerkUserId}`) return true;
  const orgRole = input.orgRole ?? "";
  const orgAdmin = orgRole === "org:admin" || orgRole === "admin";
  if (!orgAdmin || !input.orgId || !input.clerkOrgId) return false;
  return input.orgId === input.clerkOrgId;
}

/**
 * Effective operational role. A workspace owner is Owner even when no
 * project_profiles row exists, or when that row is a lesser role — the
 * account that administers the workspace can delete projects and use
 * every other action. Everyone else keeps the stored role, or Estimator
 * when they have none. ClientView and Subcontractor stay restricted.
 */
export function resolveOperationalRole(input: {
  storedRole: string | null | undefined;
  clerkUserId: string;
  clerkOrgId: string | null | undefined;
  orgId?: string | null;
  orgRole?: string | null;
}): Role {
  if (isWorkspaceOwner(input)) return "Owner";
  const stored = input.storedRole;
  if (stored && (KNOWN_ROLES as readonly string[]).includes(stored)) return stored as Role;
  return DEFAULT_ROLE;
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
export async function getUserRole(
  tenantId: string,
  clerkUserId: string,
  lookup: RoleLookup = {},
): Promise<Role> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const [{ data: profile }, { data: tenant }] = await Promise.all([
    anyDb
      .from("project_profiles")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle(),
    anyDb
      .from("tenants")
      .select("clerk_org_id")
      .eq("id", tenantId)
      .maybeSingle(),
  ]);

  const stored = profile?.role as string | undefined;
  const clerkOrgId = (tenant?.clerk_org_id ?? null) as string | null;
  const role = resolveOperationalRole({
    storedRole: stored,
    clerkUserId,
    clerkOrgId,
    orgId: lookup.orgId,
    orgRole: lookup.orgRole,
  });

  // Remember the promotion so later requests, including ones that do not
  // carry the Clerk org role, still see Owner.
  if (role === "Owner" && stored !== "Owner") {
    const { error } = await anyDb.from("project_profiles").upsert(
      {
        tenant_id: tenantId,
        clerk_user_id: clerkUserId,
        role: "Owner",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,clerk_user_id" },
    );
    if (error) console.error("[getUserRole] could not store Owner profile", error.message);
  }

  return role;
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
  lookup: RoleLookup = {},
): Promise<Role> {
  const role = await getUserRole(tenantId, clerkUserId, lookup);
  if (!canPerform(role, resource, action)) {
    throw new PermissionError(`Role '${role}' is not permitted to ${action} ${resource} resources.`);
  }
  return role;
}
