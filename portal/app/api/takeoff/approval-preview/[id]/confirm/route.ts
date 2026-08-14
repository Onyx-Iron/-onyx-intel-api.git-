import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: preview } = await anyDb.from("takeoff_approval_previews").select("payload,payload_hash").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!preview) return NextResponse.json({ error: "Approval preview not found" }, { status: 404 });
    if (hashApprovalPayload(preview.payload) !== preview.payload_hash) return NextResponse.json({ error: "Approval preview integrity check failed" }, { status: 409 });
    const { data, error } = await anyDb.rpc("confirm_takeoff_approval_preview", {
      p_tenant_id: tenantId, p_preview_id: id, p_actor_user_id: userId, p_payload_hash: preview.payload_hash,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: /permission|required/i.test(error.message) ? 403 : 409 });
    return NextResponse.json({ confirmation: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
