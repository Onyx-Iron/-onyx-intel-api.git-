import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { reprocessDocumentPages, type ReprocessStage } from "@/lib/documents/reprocessPage";

export const runtime = "nodejs";
export const maxDuration = 60;

const STAGES = new Set<ReprocessStage>(["ocr", "takeoff", "both"]);

/**
 * POST /api/documents/:id/reprocess
 * Body: { stage?: "ocr" | "takeoff" | "both", page_number?: number }
 *
 * Re-enqueues Edge workers for one page (or all split pages) without a full
 * PDF split. Use full Retry (/ingest) when pages were never split.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const body = await req.json().catch(() => ({})) as {
      stage?: string;
      page_number?: number | null;
    };
    const stage = (body.stage ?? "both") as ReprocessStage;
    if (!STAGES.has(stage)) {
      return NextResponse.json({ error: "stage must be ocr, takeoff, or both" }, { status: 400 });
    }
    const pageNumber = body.page_number == null ? null : Number(body.page_number);
    if (pageNumber != null && (!Number.isFinite(pageNumber) || pageNumber < 1)) {
      return NextResponse.json({ error: "page_number must be a positive integer" }, { status: 400 });
    }

    const db = await createServiceClient();
    const { data: doc, error: docErr } = await db
      .from("documents")
      .select("id, project_id, status")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!doc.project_id) {
      return NextResponse.json({ error: "Document has no project_id" }, { status: 422 });
    }

    try {
      const result = await reprocessDocumentPages({
        db,
        tenantId,
        projectId: doc.project_id,
        documentId,
        stage,
        pageNumber,
        source: "portal:reprocess",
      });
      return NextResponse.json({
        ok: true,
        queued: true,
        document_id: documentId,
        ...result,
      }, { status: 202 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /not found|No split pages/i.test(msg) ? 422 : 502;
      return NextResponse.json({ error: msg, code: status === 422 ? "NEED_SPLIT" : "REPROCESS_FAILED" }, { status });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/:id/reprocess] ${msg}` }, { status: 502 });
  }
}
