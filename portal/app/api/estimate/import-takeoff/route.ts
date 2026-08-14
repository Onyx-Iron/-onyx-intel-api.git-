import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission } from "@/lib/project-controls/permissions";
import { createServiceClient } from "@/lib/supabase/server";
import { validateImportCommand } from "@/lib/takeoff/import-command";

export const runtime = "nodejs";

/**
 * Manual resync trigger. Takeoff writes already auto-sync into estimate_items
 * (see lib/estimating/auto-sync.ts), so this endpoint mostly exists as a
 * user-visible "force resync" — e.g. after seeding cost_catalog rates so
 * previously-unpriced items get re-priced. Idempotent, safe to call anytime.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { project_id?: string; preview_id?: string; idempotency_key?: string };
    if (!body.project_id || !body.preview_id || !body.idempotency_key) return NextResponse.json({ error: "project_id, preview_id, and idempotency_key required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: preview } = await anyDb.from("takeoff_approval_previews")
      .select("id,project_id,status,actor_user_id").eq("id", body.preview_id).eq("tenant_id", tenantId).maybeSingle();
    if (!preview || preview.actor_user_id !== userId) return NextResponse.json({ error: "Confirmed approval preview not found" }, { status: 404 });
    const validation = validateImportCommand({ previewStatus: preview.status, previewProjectId: preview.project_id, projectId: body.project_id, idempotencyKey: body.idempotency_key });
    if (!validation.valid) return NextResponse.json({ error: validation.reason }, { status: 409 });
    const { data: existing } = await anyDb.from("takeoff_import_commands").select("id,status,result,error")
      .eq("tenant_id", tenantId).eq("idempotency_key", body.idempotency_key).maybeSingle();
    if (existing?.status === "completed") return NextResponse.json(existing.result ?? { imported: 0, idempotent: true });
    if (existing?.status === "started") return NextResponse.json({ error: "Import command is already processing" }, { status: 409 });
    const commandWrite = existing?.status === "failed"
      ? anyDb.from("takeoff_import_commands").update({ status: "started", error: null, completed_at: null }).eq("id", existing.id).eq("tenant_id", tenantId).select("id").single()
      : anyDb.from("takeoff_import_commands").insert({
        tenant_id: tenantId, project_id: body.project_id, preview_id: body.preview_id,
        idempotency_key: body.idempotency_key, actor_user_id: userId,
      }).select("id").single();
    const { data: command, error: commandError } = await commandWrite;
    if (commandError) return NextResponse.json({ error: commandError.message }, { status: 409 });
    let result;
    try {
      result = await syncTakeoffToEstimate(tenantId, body.project_id);
    } catch (syncError) {
      await anyDb.from("takeoff_import_commands").update({
        status: "failed", error: syncError instanceof Error ? syncError.message : String(syncError), completed_at: new Date().toISOString(),
      }).eq("id", command.id).eq("tenant_id", tenantId);
      throw syncError;
    }
    await anyDb.from("takeoff_import_commands").update({ status: "completed", result, completed_at: new Date().toISOString() }).eq("id", command.id).eq("tenant_id", tenantId);

    return NextResponse.json(result, { status: result.imported > 0 ? 201 : 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/estimate/import-takeoff] ${msg}` }, { status: 500 });
  }
}
