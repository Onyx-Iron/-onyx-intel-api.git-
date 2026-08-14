import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingSyncBackbone(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string };
  return row.code === "PGRST205" || /project_(sync_state|data_history)|relation .* does not exist/i.test(row.message ?? "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsedId = uuidSchema.safeParse((await params).id);
    if (!parsedId.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
    const sinceValue = Number(req.nextUrl.searchParams.get("since") ?? "0");
    const since = Number.isSafeInteger(sinceValue) && sinceValue >= 0 ? sinceValue : 0;

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = db as any;

    const { data: project } = await q
      .from("projects")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", parsedId.data)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [{ data: state, error: stateError }, { data: changes, error: changesError }] = await Promise.all([
      q.from("project_sync_state")
        .select("revision,updated_at,last_table,last_entity_id,last_operation")
        .eq("tenant_id", tenantId)
        .eq("project_id", parsedId.data)
        .maybeSingle(),
      q.from("project_data_history")
        .select("id,revision,table_name,entity_id,operation,actor_user_id,transaction_id,changed_at")
        .eq("tenant_id", tenantId)
        .eq("project_id", parsedId.data)
        .gt("revision", since)
        .order("revision", { ascending: true })
        .limit(100),
    ]);

    if (isMissingSyncBackbone(stateError) || isMissingSyncBackbone(changesError)) {
      const response = NextResponse.json({
        project_id: parsedId.data,
        revision: 0,
        updated_at: null,
        last_table: null,
        last_entity_id: null,
        last_operation: null,
        changes: [],
        degraded: true,
      });
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      return response;
    }

    if (stateError || changesError) {
      return NextResponse.json({ error: "Project synchronization is not available" }, { status: 503 });
    }

    const response = NextResponse.json({
      project_id: parsedId.data,
      revision: Number(state?.revision ?? 0),
      updated_at: state?.updated_at ?? null,
      last_table: state?.last_table ?? null,
      last_entity_id: state?.last_entity_id ?? null,
      last_operation: state?.last_operation ?? null,
      changes: changes ?? [],
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `[GET /api/projects/:id/sync] ${message}` }, { status: 500 });
  }
}
