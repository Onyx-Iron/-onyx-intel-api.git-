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
    let query = (db as any)
      .from("project_events")
      .select("*", { count: "exact" })
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (entityType) query = query.eq("entity_type", entityType);

    const { data, error, count } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Enrich with icon hint
    const events = (data ?? []).map((e: Record<string, unknown>) => ({
      ...e,
      icon: ENTITY_ICONS[e.entity_type as string] ?? "Activity",
    }));

    return NextResponse.json({
      events,
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
