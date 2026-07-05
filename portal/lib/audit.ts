/**
 * Centralized structural audit log.
 *
 * Every record creation, mutation, or deletion across core tables should
 * flow through here. Insert semantics:
 *   insert → old_values = null, new_values = the inserted row
 *   update → old_values = the row BEFORE mutation, new_values = the row AFTER
 *   delete → old_values = the row before deletion, new_values = null
 *
 * Non-blocking: callers fire-and-forget so a slow log write never delays a
 * user request. Failures are logged to console only.
 */

import { createServiceClient } from "@/lib/supabase/server";

export type AuditAction = "insert" | "update" | "delete";

export interface AuditPayload {
  tenant_id: string;
  user_id: string | null;
  action_type: AuditAction;
  table_name: string;
  record_id: string;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

export function logAudit(payload: AuditPayload): void {
  // Fire-and-forget — the returned promise is intentionally not awaited.
  void writeAudit(payload).catch((err) => {
    console.error("[audit_logs] write failed", err);
  });
}

async function writeAudit(payload: AuditPayload): Promise<void> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from("audit_logs").insert({
    tenant_id: payload.tenant_id,
    user_id: payload.user_id,
    action_type: payload.action_type,
    table_name: payload.table_name,
    record_id: payload.record_id,
    old_values: payload.old_values ?? null,
    new_values: payload.new_values ?? null,
  });
}

/**
 * Convenience helper — used by CRUD endpoints that already have the before/
 * after row shapes. Returns void; caller doesn't await.
 */
export function auditInsert(args: Omit<AuditPayload, "action_type" | "old_values">): void {
  logAudit({ ...args, action_type: "insert", old_values: null });
}
export function auditUpdate(args: Omit<AuditPayload, "action_type">): void {
  logAudit({ ...args, action_type: "update" });
}
export function auditDelete(args: Omit<AuditPayload, "action_type" | "new_values">): void {
  logAudit({ ...args, action_type: "delete", new_values: null });
}
