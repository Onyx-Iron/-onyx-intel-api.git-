import { createServiceClient } from "@/lib/supabase/server";

export type EntityType =
  | "rfi" | "schedule" | "document" | "estimate" | "takeoff"
  | "permit" | "punch_list" | "contact" | "procurement"
  | "change_order" | "daily_log" | "note" | "ai_chat" | "ai_digest" | "project"
  | "co_inspection" | "todo_item" | "weekly_log"
  | "bid_opportunity" | "email_import" | "social_post" | "seo_ping" | "cloud_import";

export type EventAction =
  | "created" | "updated" | "deleted" | "status_changed"
  | "uploaded" | "processed" | "generated" | "submitted" | "queued"
  | "imported" | "published" | "connected" | "disconnected";

export interface LogEventParams {
  projectId: string;
  tenantId: string;
  userId: string;
  entityType: EntityType;
  entityId?: string;
  action: EventAction;
  title: string;
  meta?: Record<string, unknown>;
}

export async function logEvent(params: LogEventParams): Promise<void> {
  try {
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("project_events").insert({
      project_id: params.projectId,
      tenant_id: params.tenantId,
      user_id: params.userId,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      action: params.action,
      title: params.title,
      meta: params.meta ?? {},
    });
  } catch {
    // Non-fatal — never block the main operation
  }
}
