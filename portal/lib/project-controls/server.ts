import { createServiceClient } from "@/lib/supabase/server";

interface QueryError {
  message: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
  count?: number | null;
}

export interface ControlQuery<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): ControlQuery<T>;
  insert(payload: unknown): ControlQuery<T>;
  update(payload: unknown): ControlQuery<T>;
  delete(): ControlQuery<T>;
  eq(column: string, value: unknown): ControlQuery<T>;
  in(column: string, values: readonly unknown[]): ControlQuery<T>;
  neq(column: string, value: unknown): ControlQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ControlQuery<T>;
  limit(count: number): ControlQuery<T>;
  range(from: number, to: number): ControlQuery<T>;
  single(): ControlQuery<T>;
}

export interface ControlDb {
  from<T>(table: string): ControlQuery<T>;
}

export async function getOrCreateTenant(orgId: string, orgName: string): Promise<string> {
  const db = await createServiceClient();
  const { data } = await db.from("tenants").select("id").eq("clerk_org_id", orgId).single();
  if (data?.id) return data.id;

  const { data: created, error } = await db
    .from("tenants")
    .insert({ clerk_org_id: orgId, name: orgName })
    .select("id")
    .single();

  if (error || !created) throw new Error(`[tenant] ${error?.message ?? "create failed"}`);
  return created.id;
}

export async function getControlDb(): Promise<ControlDb> {
  return (await createServiceClient()) as unknown as ControlDb;
}

export function authTenantKey(userId: string, orgId: string | null | undefined): string {
  return orgId ?? `user_${userId}`;
}

export function authTenantName(userId: string, orgSlug: string | null | undefined): string {
  return orgSlug ?? userId;
}

export function requireProjectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("project_id required");
  }
  return value.trim();
}

/**
 * Verifies that `projectId` actually belongs to `tenantId` before it's used to
 * scope an insert. POST handlers across rfis/change-orders/submittals/
 * invoices/daily-logs accept a client-supplied project_id and previously
 * inserted it unchecked alongside the caller's own tenant_id — so a request
 * carrying a project_id from a *different* tenant would succeed, creating a
 * row whose tenant_id and project_id point at different tenants (referential
 * corruption, and a cross-tenant leak wherever downstream code joins by
 * project_id alone). Throws if the project doesn't exist under that tenant.
 */
export async function assertProjectBelongsToTenant(projectId: string, tenantId: string): Promise<void> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) {
    throw new Error("project_id does not belong to this tenant");
  }
}
