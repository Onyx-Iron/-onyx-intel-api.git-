import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";

export const runtime = "nodejs";

const ENTITY_ICONS: Record<string, string> = {
  rfi: "MessageSquare",
  schedule: "Calendar",
  document: "FileText",
  estimate: "DollarSign",
  takeoff: "Ruler",
  permit: "ClipboardCheck",
  punch_list: "CheckSquare",
  contact: "User",
  procurement: "ShoppingCart",
  change_order: "GitBranch",
  daily_log: "BookOpen",
  note: "StickyNote",
  ai_chat: "Bot",
  ai_digest: "Shield",
  project: "Briefcase",
};

const TABLE_ENTITY: Record<string, string> = {
  projects: "project",
  documents: "document",
  document_pages: "document",
  document_chunks: "document",
  document_intelligence: "document",
  chunks: "document",
  takeoff_items: "takeoff",
  manual_takeoffs: "takeoff",
  estimate_items: "estimate",
  estimates: "estimate",
  estimate_versions: "estimate",
  schedule_tasks: "schedule",
  rfi_items: "rfi",
  submittal_items: "submittal",
  change_order_items: "change_order",
  procurement_items: "procurement",
  marketplace_requests: "procurement",
  purchase_orders: "procurement",
  contacts: "contact",
  material_vendors: "contact",
  equipment_suppliers: "contact",
  daily_logs: "daily_log",
  weekly_logs: "weekly_log",
  todo_items: "todo_item",
  punch_list_items: "punch_list",
  permit_items: "permit",
  co_inspections: "co_inspection",
};

function tableLabel(table: string): string {
  return table.replace(/^project_/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const projectId = sp.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const entityType = sp.get("type"); // optional filter
    const { page, limit, offset } = parsePagination(sp, 40);

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventQuery = (db as any)
      .from("project_events")
      .select("*", { count: "exact" })
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(Math.min(offset + limit * 2, 200));

    if (entityType) eventQuery = eventQuery.eq("entity_type", entityType);

    // Database-backed history covers mutations that do not explicitly call
    // logEvent (including Railway extraction workers).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historyQuery = (db as any)
      .from("project_data_history")
      .select("id,revision,table_name,entity_id,operation,actor_user_id,transaction_id,changed_at", { count: "exact" })
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("revision", { ascending: false })
      .limit(Math.min(offset + limit * 4, 400));

    const [eventResult, historyResult] = await Promise.all([eventQuery, historyQuery]);
    const { data, error, count } = eventResult;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const explicitEvents = (data ?? []).map((e: Record<string, unknown>) => ({
      ...e,
      icon: ENTITY_ICONS[e.entity_type as string] ?? "Activity",
    }));

    const groups = new Map<string, Array<Record<string, unknown>>>();
    if (!historyResult.error) {
      for (const row of (historyResult.data ?? []) as Array<Record<string, unknown>>) {
        const mappedType = TABLE_ENTITY[String(row.table_name)] ?? String(row.table_name);
        if (entityType && mappedType !== entityType) continue;
        const key = `${row.transaction_id}:${row.table_name}:${row.operation}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
    }

    const historyEvents = [...groups.values()].map((rows) => {
      const first = rows[0];
      const operation = String(first.operation);
      const entityTypeName = TABLE_ENTITY[String(first.table_name)] ?? String(first.table_name);
      const action = operation === "insert" ? "created" : operation === "delete" ? "deleted" : "updated";
      const label = tableLabel(String(first.table_name));
      return {
        id: `history-${String(first.id)}`,
        project_id: projectId,
        tenant_id: tenantId,
        user_id: String(first.actor_user_id ?? "system"),
        entity_type: entityTypeName,
        entity_id: rows.length === 1 ? first.entity_id : null,
        action,
        title: rows.length === 1 ? `${label} ${action}` : `${rows.length} ${label} records ${action}`,
        meta: { source: "project_data_history", revision: first.revision, count: rows.length },
        created_at: String(first.changed_at),
        icon: ENTITY_ICONS[entityTypeName] ?? "Activity",
      };
    });

    const explicitKeys = new Set(explicitEvents.map((event: Record<string, unknown>) =>
      `${event.entity_type}:${event.entity_id ?? ""}:${event.action}`));
    const merged = [...explicitEvents, ...historyEvents.filter((event) =>
      !event.entity_id || !explicitKeys.has(`${event.entity_type}:${event.entity_id}:${event.action}`))]
      .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());
    const events = merged.slice(offset, offset + limit);

    return NextResponse.json({
      events,
      pagination: paginationMeta((count ?? 0) + (historyResult.count ?? 0), page, limit),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
