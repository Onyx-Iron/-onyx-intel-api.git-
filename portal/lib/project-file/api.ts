import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  assertProjectBelongsToTenant,
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { canReadFinancial, getUserRole, type Role } from "@/lib/project-controls/permissions";
import { subCanSeeRecord } from "@/lib/project-file/records";
import type { ResourceCategory } from "@/lib/project-controls/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = any;

export interface ProjectContext {
  userId: string;
  tenantId: string;
  db: AnyDb;
  role: Role;
  canReadFinancial: boolean;
}

export async function projectContext(projectId: string | null): Promise<
  { ok: true; ctx: ProjectContext; projectId: string } | { ok: false; response: NextResponse }
> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!projectId) return { ok: false, response: NextResponse.json({ error: "project_id required" }, { status: 400 }) };
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("does not belong") ? 403 : 400;
    return { ok: false, response: NextResponse.json({ error: msg }, { status }) };
  }
  const db = await createServiceClient();
  const role = await getUserRole(tenantId, userId);
  return {
    ok: true,
    projectId,
    ctx: { userId, tenantId, db: db as AnyDb, role, canReadFinancial: canReadFinancial(role) },
  };
}

export async function requireProjectWrite(
  ctx: ProjectContext,
  resource: ResourceCategory,
): Promise<NextResponse | null> {
  return requirePermission(ctx.tenantId, ctx.userId, resource, "write");
}

export function redactAmounts<T extends Record<string, unknown>>(
  row: T,
  allowed: boolean,
  fields: readonly string[],
): T {
  if (allowed) return row;
  const next = { ...row };
  for (const field of fields) {
    if (field in next) (next as Record<string, unknown>)[field] = null;
  }
  return next;
}

export const MONEY_FIELDS = [
  "amount",
  "original_amount",
  "approved_change_amount",
  "forecast_override",
  "total_price",
  "revised",
  "forecast_to_complete",
  "projected_final",
  "projected_margin",
  "committed",
  "actual",
  "scheduled_value",
  "previous_amount",
  "this_period",
  "stored_materials",
  "retainage",
  "balance",
  "unit_price",
  "hourly_rate",
  "total_amount",
] as const;

export async function rowsForSubcontractor<T extends { ball_contact_id?: string | null }>(
  role: Role,
  db: AnyDb,
  tenantId: string,
  projectId: string,
  userId: string,
  rows: T[],
): Promise<T[]> {
  if (role !== "Subcontractor") return rows;
  const contactId = await viewerContactId(db, tenantId, projectId, userId);
  return rows.filter((row) => subCanSeeRecord({ role: "Subcontractor", contactId }, row.ball_contact_id ?? null));
}

export async function viewerContactId(db: AnyDb, tenantId: string, projectId: string, userId: string): Promise<string | null> {
  const { data } = await db
    .from("project_contacts")
    .select("contact_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("clerk_user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data?.contact_id as string | undefined) ?? null;
}
