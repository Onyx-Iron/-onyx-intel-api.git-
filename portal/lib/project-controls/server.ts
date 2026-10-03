import { createServiceClient } from "@/lib/supabase/server";
import { seedStarterCostCatalog } from "@/lib/cost/starter-catalog";
import { coalesceAsync } from "@/lib/project-controls/tenant-cache";

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

const tenantIds = new Map<string, string>();
const tenantLookups = new Map<string, Promise<string>>();

export function clearTenantCache(): void {
  tenantIds.clear();
  tenantLookups.clear();
}

export async function getOrCreateTenant(orgId: string, orgName: string): Promise<string> {
  return coalesceAsync(tenantIds, tenantLookups, orgId, async () => {
    const db = await createServiceClient();
    const { data } = await db.from("tenants").select("id").eq("clerk_org_id", orgId).single();
    if (data?.id) return data.id;

    const { data: created, error } = await db
      .from("tenants")
      .insert({ clerk_org_id: orgId, name: orgName })
      .select("id")
      .single();

    if (error || !created) throw new Error(`[tenant] ${error?.message ?? "create failed"}`);

    // Auto-seed starter cost rates so a brand-new tenant never silently sits
    // with an empty cost_catalog until someone manually finds and clicks
    // "Seed starter rates" — same failure mode the (now-seeded) global
    // cost_codes catalog had. Best-effort: a seeding failure shouldn't block
    // tenant creation.
    void seedStarterCostCatalog(db, created.id).catch((e) =>
      console.error("[getOrCreateTenant] starter catalog seed failed", e),
    );

    return created.id;
  });
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

/**
 * Verifies a `document_pages.id` (a "sheet") actually belongs to the given
 * project, under the given tenant — via its parent `documents` row
 * (document_pages has no project_id of its own; project ownership is
 * inherited through documents.project_id). Confirmed gap (professional-
 * manual-takeoff milestone, STEP 25/PERMANENT RULE 6/10): the manual-takeoff
 * canvas routes validated project_id ownership but never validated that the
 * client-supplied page_id actually belonged to that project — a caller could
 * attach a takeoff row to a page/document from a different project (or a
 * different tenant entirely) with no server-side check. Throws if the page
 * doesn't exist, or exists but under a different tenant/document/project.
 */
export async function assertPageBelongsToProject(pageId: string, projectId: string, tenantId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createServiceClient()) as any;
  const { data: page, error: pageErr } = await db
    .from("document_pages")
    .select("id, document_id, tenant_id")
    .eq("id", pageId)
    .eq("tenant_id", tenantId)
    .single();
  if (pageErr || !page) {
    throw new Error("page_id does not belong to this tenant");
  }

  const { data: doc, error: docErr } = await db
    .from("documents")
    .select("id")
    .eq("id", page.document_id)
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .single();
  if (docErr || !doc) {
    throw new Error("page_id does not belong to this project");
  }
}
