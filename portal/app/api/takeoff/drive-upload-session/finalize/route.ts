import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * POST /api/takeoff/drive-upload-session/finalize
 *
 * Body: { document_id, drive_file_id }
 *
 * Called after the browser's direct PUT to the Drive resumable session URI
 * completes — Drive's response body contains the newly created file's id,
 * which the client hands back here to attach to the pre-inserted documents
 * row (see /drive-upload-session). From this point the document behaves
 * exactly like a Drive-imported document everywhere else in the app.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { document_id, drive_file_id } = await req.json().catch(() => ({})) as {
      document_id?: string; drive_file_id?: string;
    };
    if (!document_id || !drive_file_id) {
      return NextResponse.json({ error: "document_id and drive_file_id are required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    const db = await createServiceClient();

    const { data: doc, error: findErr } = await db
      .from("documents")
      .select("id, meta")
      .eq("id", document_id).eq("tenant_id", tenantId)
      .single();
    if (findErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta as Record<string, unknown> | null) ?? {};
    if (meta.pending_drive_upload !== true || meta.upload_session_started_by !== userId) {
      return NextResponse.json({ error: "Upload session is not pending for this user" }, { status: 409 });
    }
    const { pending_drive_upload: _pending, ...restMeta } = meta;
    void _pending;

    const { error: updateErr } = await db
      .from("documents")
      .update({
        drive_file_id,
        meta: { ...restMeta, drive_file_id } as never,
      })
      .eq("id", document_id).eq("tenant_id", tenantId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[drive-upload-session/finalize] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
