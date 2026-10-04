import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google/oauth";
import { downloadGmailAttachment } from "@/lib/google/gmailPlans";
import { importPlanBytes } from "@/lib/documents/importBytes";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/google/gmail/import-attachment
 * Body: { project_id, message_id, attachment_id, filename, mime_type?, create_bid_card? }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      message_id?: string;
      attachment_id?: string;
      filename?: string;
      mime_type?: string;
      create_bid_card?: boolean;
      bid_name?: string;
    };

    if (!body.project_id || !body.message_id || !body.attachment_id || !body.filename) {
      return NextResponse.json(
        { error: "project_id, message_id, attachment_id, and filename are required" },
        { status: 400 },
      );
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    try {
      await assertProjectBelongsToTenant(body.project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const token = await getAccessToken(tenantId, userId);
    if (!token) {
      return NextResponse.json(
        { error: "Google is not connected. Connect Google in Settings → Connections.", code: "NEED_GOOGLE" },
        { status: 412 },
      );
    }

    const bytes = await downloadGmailAttachment(token, body.message_id, body.attachment_id);
    const result = await importPlanBytes({
      tenantId,
      userId,
      projectId: body.project_id,
      fileName: body.filename,
      mimeType: body.mime_type ?? "application/pdf",
      bytes,
      source: "gmail",
      sourceMeta: {
        gmail_message_id: body.message_id,
        gmail_attachment_id: body.attachment_id,
      },
      origin: req.nextUrl.origin,
      cookie: req.headers.get("cookie"),
    });

    let bidOpportunityId: string | null = null;
    if (body.create_bid_card) {
      const db = await createServiceClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bid } = await (db as any)
        .from("bid_opportunities")
        .insert({
          tenant_id: tenantId,
          project_id: body.project_id,
          name: body.bid_name?.trim() || body.filename.replace(/\.[^.]+$/, ""),
          stage: "takeoff",
          source: "gmail",
          source_ref: body.message_id,
          meta: { document_ids: [result.documentId] },
          created_by: userId,
        })
        .select("id")
        .maybeSingle();
      bidOpportunityId = bid?.id ?? null;
    }

    return NextResponse.json({
      document_id: result.documentId,
      status: result.status,
      async_split: result.asyncSplit,
      bid_opportunity_id: bidOpportunityId,
    }, { status: 202 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // bid_opportunities may not exist until M2 migration is applied — ignore soft
    if (msg.includes("bid_opportunities")) {
      return NextResponse.json({ error: msg, hint: "Document may have imported; bid card requires bid_opportunities migration." }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
