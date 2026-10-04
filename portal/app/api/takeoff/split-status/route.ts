import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { reclaimStuckProcessingPages } from "@/lib/documents/reclaimStuck";
import { finalizeDocumentsFromOcr } from "@/lib/documents/finalizeDocument";
import { isTerminalFailure } from "@/lib/documents/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/takeoff/split-status?document_id=&project_id=
 *
 * Polling endpoint for the async page-split pipeline (large local uploads
 * and Drive imports alike). Reports per-page takeoff-extraction progress
 * from `document_pages.takeoff_status` — NOT `status`, which belongs to the
 * separate OCR/embedding worker and would race with this if conflated.
 *
 * Does **not** mark `documents.status` complete from takeoff alone — OCR
 * (`document_pages.status`) must also be terminal. `finalizeDocumentsFromOcr`
 * is the shared gate used by the Documents list.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const documentId = req.nextUrl.searchParams.get("document_id");
  if (!documentId) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: docRow, error: docErr } = await anyDb
    .from("documents")
    .select("id, status, page_count, project_id, last_error, meta")
    .eq("id", documentId).eq("tenant_id", tenantId)
    .maybeSingle();
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
  if (!docRow) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Reclaim pages stuck in processing before reporting progress so polls
  // eventually surface terminal errors instead of spinning forever.
  await reclaimStuckProcessingPages(anyDb, tenantId, undefined, documentId).catch((err) =>
    console.error("[GET /api/takeoff/split-status] stuck page reclaim failed", err),
  );

  const { data: pages, error: pagesErr } = await anyDb
    .from("document_pages")
    .select("page_number, status, takeoff_status, takeoff_error")
    .eq("document_id", documentId).eq("tenant_id", tenantId)
    .order("page_number", { ascending: true });
  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 });

  const rows = (pages ?? []) as Array<{
    page_number: number;
    status: string | null;
    takeoff_status: string | null;
    takeoff_error: string | null;
  }>;
  const total = rows.length;
  const done = rows.filter((p) => p.takeoff_status === "done").length;
  const errored = rows.filter((p) => p.takeoff_status === "error").length;
  const settled = done + errored;

  // Not split yet (page-split-worker hasn't inserted document_pages rows —
  // still downloading/bursting the original PDF, or it failed before that).
  if (total === 0) {
    return NextResponse.json({
      document_status: docRow.status,
      page_count: docRow.page_count ?? null,
      pages_total: 0,
      pages_done: 0,
      pages_error: 0,
      finished: isTerminalFailure(docRow.status),
      error: docRow.last_error ?? null,
    });
  }

  // Takeoff-only complete was a race with OCR. Shared finalize waits for both.
  await finalizeDocumentsFromOcr(anyDb, tenantId, [documentId]).catch((err) =>
    console.error("[GET /api/takeoff/split-status] OCR/takeoff finalize failed", err),
  );
  const { data: refreshed } = await anyDb
    .from("documents")
    .select("id, status, last_error")
    .eq("id", documentId).eq("tenant_id", tenantId)
    .maybeSingle();
  if (refreshed) {
    docRow.status = refreshed.status;
    docRow.last_error = refreshed.last_error;
  }

  // Once complete, hand back the actual extracted rows so the client can
  // populate the grid without a second round-trip.
  let items: unknown[] = [];
  if (settled === total) {
    const { data: takeoffItems } = await anyDb
      .from("takeoff_items")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", docRow.project_id).eq("document_id", documentId)
      .order("page", { ascending: true });
    items = takeoffItems ?? [];
  }

  return NextResponse.json({
    document_status: docRow.status,
    page_count: docRow.page_count ?? total,
    pages_total: total,
    pages_done: done,
    pages_error: errored,
    finished: settled === total,
    items,
    page_errors: rows.filter((p) => p.takeoff_status === "error").map((p) => ({ page_number: p.page_number, error: p.takeoff_error })),
  });
}
