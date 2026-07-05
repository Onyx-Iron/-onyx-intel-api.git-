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

// A user with no project_profiles row yet (first login) defaults to the most
// capable role rather than silently locking the tenant's own owner out —
// `getOrCreateTenant` already gates workspace creation, so anyone reaching
// this point is a legitimate member of the org.
const DEFAULT_ROLE: Role = "Estimator";

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
  return (role && (KNOWN_ROLES as readonly string[]).includes(role)) ? (role as Role) : DEFAULT_ROLE;
}

export function canPerform(role: Role, resource: ResourceCategory, action: Action): boolean {
  if (action === "read") return true;
  if (READ_ONLY_ROLES.has(role)) return false;
  return WRITE_MATRIX[resource].has(role);
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
