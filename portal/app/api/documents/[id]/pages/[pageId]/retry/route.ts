import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { invokePageWorker, type PageWorkerKind } from "@/lib/documents/pageWorkers";
import {
  documentStatusAfterPageRetry,
  invokeFailureRollback,
  planPageRetry,
} from "@/lib/documents/retryPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/documents/[id]/pages/[pageId]/retry
 *
 * Re-queue a failed OCR and/or takeoff page worker. Body optional:
 *   { stages?: ("ocr" | "takeoff")[] }
 * When omitted, retries every stage currently in error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId, pageId } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const body = await req.json().catch(() => ({})) as { stages?: unknown };
    let requested: PageWorkerKind[] | null = null;
    if (Array.isArray(body.stages)) {
      const allowed = new Set<PageWorkerKind>(["ocr", "takeoff"]);
      requested = [];
      for (const s of body.stages) {
        if (typeof s !== "string" || !allowed.has(s as PageWorkerKind)) {
          return NextResponse.json({ error: "stages must be ocr and/or takeoff" }, { status: 400 });
        }
        requested.push(s as PageWorkerKind);
      }
    }

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: docRow, error: docErr } = await anyDb
      .from("documents")
      .select("id, status, project_id")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
    if (!docRow) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const { data: pageRow, error: pageErr } = await anyDb
      .from("document_pages")
      .select("id, status, takeoff_status, storage_path, page_number, document_id, tenant_id")
      .eq("id", pageId)
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 });
    if (!pageRow) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const plan = planPageRetry(pageRow, requested);
    if ("error" in plan) {
      return NextResponse.json({ error: plan.error }, { status: 409 });
    }

    const { error: updErr } = await anyDb
      .from("document_pages")
      .update(plan.pagePatch)
      .eq("id", pageId)
      .eq("tenant_id", tenantId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    const nextDocStatus = documentStatusAfterPageRetry(String(docRow.status ?? ""));
    if (nextDocStatus) {
      await anyDb
        .from("documents")
        .update({
          status: nextDocStatus,
          last_error: null,
          last_error_step: null,
          processing_started_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("tenant_id", tenantId);
    }

    const payload = {
      page_id: pageRow.id as string,
      document_id: documentId,
      tenant_id: tenantId,
      project_id: docRow.project_id as string,
      page_number: pageRow.page_number as number,
      storage_path: pageRow.storage_path as string,
    };

    const invokeErrors: string[] = [];
    for (const stage of plan.stages) {
      try {
        await invokePageWorker(stage, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        invokeErrors.push(`${stage}: ${msg}`);
        console.error(`[POST /api/documents/:id/pages/:pageId/retry] ${stage}`, err);
        // The stage was already set to pending. Put it back to error only if
        // the worker has not claimed it, so a timed-out but still-running
        // extract is not marked failed on top of a later success.
        const rollback = invokeFailureRollback(stage, msg);
        const { error: rollbackErr } = await anyDb
          .from("document_pages")
          .update(rollback.patch)
          .eq("id", pageId)
          .eq("tenant_id", tenantId)
          .eq(rollback.pendingColumn, "pending");
        if (rollbackErr) {
          console.error(`[POST /api/documents/:id/pages/:pageId/retry] rollback ${stage}`, rollbackErr);
        }
      }
    }

    if (invokeErrors.length === plan.stages.length) {
      return NextResponse.json(
        { error: `Failed to invoke workers: ${invokeErrors.join("; ")}`, stages: plan.stages },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      page_id: pageId,
      document_id: documentId,
      stages: plan.stages,
      document_status: nextDocStatus ?? docRow.status,
      invoke_errors: invokeErrors.length > 0 ? invokeErrors : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[POST /api/documents/:id/pages/:pageId/retry] ${msg}` },
      { status: 500 },
    );
  }
}
