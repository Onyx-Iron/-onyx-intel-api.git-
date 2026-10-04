import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { reclaimStuckProcessingPages } from "@/lib/documents/reclaimStuck";
import {
  formatStageProgress,
  summarizePipelineProgress,
  type PageProgressRow,
} from "@/lib/documents/pipelineProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/[id]/pipeline
 *
 * Live OCR + takeoff page counts for Documents UI polling. Complements
 * /api/takeoff/split-status (takeoff-only finalize) with per-stage rollups
 * and failed-page ids for targeted retry.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: docRow, error: docErr } = await anyDb
      .from("documents")
      .select("id, status, page_count, split_status, ocr_status, takeoff_status, last_error, last_error_step")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
    if (!docRow) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    await reclaimStuckProcessingPages(anyDb, tenantId, undefined, documentId).catch((err) =>
      console.error("[GET /api/documents/:id/pipeline] stuck page reclaim failed", err),
    );

    const { data: pages, error: pagesErr } = await anyDb
      .from("document_pages")
      .select("id, page_number, status, error, takeoff_status, takeoff_error, storage_path")
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .order("page_number", { ascending: true });
    if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 });

    const rows = (pages ?? []) as PageProgressRow[];
    const progress = summarizePipelineProgress(rows);

    return NextResponse.json({
      document_id: documentId,
      document_status: docRow.status,
      page_count: docRow.page_count ?? (rows.length > 0 ? rows.length : null),
      split_status: docRow.split_status ?? null,
      ocr_status: docRow.ocr_status ?? null,
      takeoff_status: docRow.takeoff_status ?? null,
      last_error: docRow.last_error ?? null,
      last_error_step: docRow.last_error_step ?? null,
      ocr: progress.ocr,
      takeoff: progress.takeoff,
      failed_pages: progress.failed_pages,
      finished: progress.finished,
      labels: {
        ocr: formatStageProgress("OCR", progress.ocr),
        takeoff: formatStageProgress("Takeoff", progress.takeoff),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/pipeline] ${msg}` }, { status: 500 });
  }
}
