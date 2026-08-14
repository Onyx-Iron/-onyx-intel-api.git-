import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { finalSplitStatus, isSplitStartStale } from "@/lib/takeoff/pipeline-status";
import { advanceTakeoffPageJob, createGovernedPageContext } from "@/lib/takeoff/governance-server";
import { validateTextQuantityCandidate } from "@/lib/takeoff/quantity-validation";

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
 * Also finalizes `documents.status` to "done"/"failed" once every split page
 * has a terminal takeoff_status — neither Edge Function has a "this was the
 * last page" signal on its own, so recomputing it here on each poll (an
 * idempotent, side-effect-safe check) is the simplest correct place for it.
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
    .select("id, status, page_count, project_id, last_error, updated_at, uploaded_at")
    .eq("id", documentId).eq("tenant_id", tenantId)
    .maybeSingle();
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
  if (!docRow) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: pages, error: pagesErr } = await anyDb
    .from("document_pages")
    .select("id, page_number, takeoff_status, takeoff_error, checksum, storage_path")
    .eq("document_id", documentId).eq("tenant_id", tenantId)
    .order("page_number", { ascending: true });
  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 });

  const rows = (pages ?? []) as Array<{ id: string; page_number: number; takeoff_status: string | null; takeoff_error: string | null; checksum: string | null; storage_path: string }>;
  const total = rows.length;
  const done = rows.filter((p) => p.takeoff_status === "done").length;
  const errored = rows.filter((p) => p.takeoff_status === "error").length;
  const settled = done + errored;

  // Not split yet (page-split-worker hasn't inserted document_pages rows —
  // still downloading/bursting the original PDF, or it failed before that).
  if (total === 0) {
    if (isSplitStartStale({ status: docRow.status, updatedAt: docRow.updated_at, uploadedAt: docRow.uploaded_at })) {
      const timeoutMessage = "Takeoff page splitting did not start within 8 minutes. Retry the upload; the previous attempt is safe to replace.";
      await anyDb.from("documents")
        .update({ status: "error", last_error: timeoutMessage, last_error_step: "split_timeout" })
        .eq("id", documentId).eq("tenant_id", tenantId);
      docRow.status = "error";
      docRow.last_error = timeoutMessage;
    }
    return NextResponse.json({
      document_status: docRow.status,
      page_count: docRow.page_count ?? null,
      pages_total: 0,
      pages_done: 0,
      pages_error: 0,
      finished: docRow.status === "error",
      error: docRow.last_error ?? null,
    });
  }

  // Finalize documents.status once every page has a terminal takeoff_status.
  const computedFinalStatus = finalSplitStatus(done, errored, total);
  if (computedFinalStatus && docRow.status !== "complete" && docRow.status !== "error") {
    const finalStatus = computedFinalStatus;
    await anyDb.from("documents")
      .update({ status: finalStatus, processed_at: new Date().toISOString() })
      .eq("id", documentId).eq("tenant_id", tenantId);
    docRow.status = finalStatus;
  }

  // Once complete, hand back the actual extracted rows so the client can
  // populate the grid without a second round-trip.
  let items: unknown[] = [];
  let aiCandidatePages: number[] = [];
  let aiPageRefs: Array<{ page_number: number; page_id: string }> = [];
  if (settled === total) {
    let { data: takeoffItems } = await anyDb
      .from("takeoff_items")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", docRow.project_id).eq("document_id", documentId)
      .order("page", { ascending: true });

    // The Edge worker is deliberately unable to approve or price anything.
    // Once it finishes, this authenticated server route attaches the same
    // job/revision/quantity evidence used by synchronous extraction.
    let governedAny = false;
    for (const page of rows) {
      const candidates = (takeoffItems ?? []).filter((item: Record<string, unknown>) =>
        item.page === page.page_number && !item.takeoff_job_id && ["suggested", "reviewed"].includes(String(item.review_status)),
      );
      if (candidates.length === 0) continue;
      let checksum = page.checksum?.trim() ?? "";
      if (!checksum) {
        const downloaded = await db.storage.from("plans-bucket").download(page.storage_path);
        if (downloaded.error || !downloaded.data) {
          await anyDb.from("document_pages").update({ takeoff_status: "error", takeoff_error: "Source checksum verification failed" }).eq("id", page.id).eq("tenant_id", tenantId);
          return NextResponse.json({ error: `Page ${page.page_number} source checksum could not be verified` }, { status: 409 });
        }
        checksum = createHash("sha256").update(new Uint8Array(await downloaded.data.arrayBuffer())).digest("hex");
        await anyDb.from("document_pages").update({ checksum }).eq("id", page.id).eq("tenant_id", tenantId);
      }
      const context = await createGovernedPageContext({
        db: anyDb, tenantId, projectId: docRow.project_id, documentId, pageId: page.id,
        pageNumber: page.page_number, sourceChecksum: checksum, actorUserId: userId,
      });
      const validations = [];
      for (const candidate of candidates) {
        const meta = candidate.meta && typeof candidate.meta === "object" ? candidate.meta as Record<string, unknown> : {};
        const rawText = typeof meta.quantity_basis === "string" ? meta.quantity_basis : "";
        const validation = validateTextQuantityCandidate({
          sourceChecksum: checksum, authoritativeChecksum: context.authoritativeChecksum,
          manifestVersion: context.manifestVersion, authoritativeManifestVersion: context.authoritativeManifestVersion,
          unit: typeof candidate.unit === "string" ? candidate.unit : "",
          submittedQuantity: typeof candidate.quantity === "number" ? candidate.quantity : Number(candidate.quantity),
          rawText, sourceKind: "text", pageNumber: page.page_number,
        });
        validations.push(validation);
        const { error: updateError } = await anyDb.from("takeoff_items").update({
          takeoff_job_id: context.jobId, source_manifest_id: context.manifestId,
          source_manifest_version: context.manifestVersion, source_checksum: checksum,
          quantity_validation_status: validation.status,
          quantity_validation_reason: validation.status === "blocked" ? validation.reason : null,
          formula_version: validation.status === "validated" ? validation.formulaVersion : null,
          calculation_checksum: validation.status === "validated" ? validation.calculationChecksum : null,
          source_provenance: {
            page_id: page.id, page_number: page.page_number, source_kind: "text", raw_text: rawText,
            measurement_basis: "source_text", source_checksum: checksum, manifest_version: context.manifestVersion,
          },
        }).eq("id", candidate.id).eq("tenant_id", tenantId).eq("project_id", docRow.project_id)
          .in("review_status", ["suggested", "reviewed"]);
        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 422 });
      }
      await advanceTakeoffPageJob(anyDb, tenantId, context.jobId, context.unitId, userId, validations.every((validation) => validation.status === "validated"));
      governedAny = true;
    }
    if (governedAny) {
      const refreshed = await anyDb.from("takeoff_items").select("*")
        .eq("tenant_id", tenantId).eq("project_id", docRow.project_id).eq("document_id", documentId)
        .order("page", { ascending: true });
      if (refreshed.error) return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
      takeoffItems = refreshed.data;
    }
    items = takeoffItems ?? [];
    const pagesWithItems = new Set(
      (takeoffItems ?? [])
        .map((item: { page?: number | null }) => typeof item.page === "number" ? item.page : null)
        .filter((page: number | null): page is number => page !== null),
    );
    aiPageRefs = rows
      .filter((page: { id: string; page_number: number }) => !pagesWithItems.has(page.page_number))
      .map((page: { id: string; page_number: number }) => ({ page_number: page.page_number, page_id: page.id }));
    aiCandidatePages = aiPageRefs.map((page: { page_number: number }) => page.page_number);
  }

  return NextResponse.json({
    document_status: docRow.status,
    page_count: docRow.page_count ?? total,
    pages_total: total,
    pages_done: done,
    pages_error: errored,
    finished: settled === total,
    items,
    ai_candidate_pages: aiCandidatePages,
    ai_page_refs: aiPageRefs,
    page_errors: rows.filter((p) => p.takeoff_status === "error").map((p) => ({ page_number: p.page_number, error: p.takeoff_error })),
  });
}
