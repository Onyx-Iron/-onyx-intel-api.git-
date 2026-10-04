import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { getAccessToken } from "@/lib/google/oauth";
import { logEvent } from "@/lib/activity";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { fetchDriveFileSize } from "@/lib/google/driveFile";
import { resolveDocumentStorageBucket } from "@/lib/documents/storage";
import { PDFDocument } from "pdf-lib";
import { looksLikePdf, publishSheetPages } from "@/lib/documents/sheet-pages";
import { missingPageNumbers, normalizeDocumentClass, pdfDeclaresEncryption } from "@/lib/documents/processing-display";
import { extractionFromPageText, readPdfPageText } from "@/lib/documents/extraction-fallback";
import { measurePdfBytes, saveMeasuredPages } from "@/lib/takeoff/measure-pdf";
import { unlockPdf } from "@/lib/documents/pdf-unlock";
import {
  PLANS_BUCKET,
  ASYNC_SPLIT_BYTES,
  shouldAsyncSplitPdf,
  queueDriveDocumentForPageSplit,
  queueLocalDocumentForPageSplit,
} from "@/lib/documents/queuePageSplit";
import { ingestStampIsLive, shouldSkipLiveIngest } from "@/lib/documents/ingest-start";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Leave headroom under Vercel maxDuration=300 so we can write error status before kill. */
const INGEST_BUDGET_MS = 270_000;
/** Skip duplicate fire-and-forget ingest while another run is in-flight. */
const CONCURRENT_INGEST_MS = INGEST_BUDGET_MS;
const TERMINAL_STATUSES = new Set(["complete", "ready", "done"]);

interface GeminiPage {
  page_number: number;
  summary: string;
  key_terms: string[];
}

interface ExtractionResult {
  doc_type: string;
  page_count: number;
  title: string;
  pages: GeminiPage[];
}

function splitChunks(text: string, chunkSize = 2200, overlap = 260): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 40) chunks.push(chunk);
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: docId } = await params;
  let tenantId: string | null = null;
  const startedAt = Date.now();

  const markError = async (message: string, step: string) => {
    try {
      const db = await createServiceClient();
      let q = db.from("documents").update({
        status: "error",
        last_error: message.slice(0, 2000),
        last_error_step: step,
      }).eq("id", docId);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      await q;
    } catch { /* best effort */ }
  };

  const assertWithinBudget = async (step: string) => {
    if (Date.now() - startedAt < INGEST_BUDGET_MS) return;
    const msg = `Ingest timed out during ${step} (budget ${INGEST_BUDGET_MS}ms). Re-run ingest to retry.`;
    await markError(msg, step);
    throw new Error(msg);
  };

  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as { access_token?: string; password?: string };
    const accessToken = body.access_token; // optional — server falls back to stored token
    const pdfPassword = typeof body.password === "string" ? body.password : "";

    tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    // Narrowed const, since `tenantId` is captured by the markError() closure above,
    // which blocks TS's normal control-flow narrowing of the `let` for the rest of this function.
    const resolvedTenantId: string = tenantId;
    const denied = await requirePermission(resolvedTenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const { data: ownershipDoc } = await db
      .from("documents")
      .select("project_id")
      .eq("id", docId)
      .eq("tenant_id", resolvedTenantId)
      .maybeSingle();
    if (!ownershipDoc?.project_id) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    try {
      await assertProjectBelongsToTenant(ownershipDoc.project_id, resolvedTenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const { data: doc, error: docErr } = await db
      .from("documents")
      .select("id, file_name, project_id, drive_file_id, meta, status, processing_started_at")
      .eq("id", docId)
      .eq("tenant_id", resolvedTenantId)
      .single();
    if (docErr || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (TERMINAL_STATUSES.has(doc.status)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_complete" });
    }

    const priorStartedAt = doc.processing_started_at as string | null;
    const stampIsLive = ingestStampIsLive(doc.status, priorStartedAt, Date.now(), CONCURRENT_INGEST_MS);
    let claimedByIngest = false;
    if (stampIsLive && priorStartedAt) {
      const { count, error: claimEventErr } = await db
        .from("document_processing_events")
        .select("id", { count: "exact", head: true })
        .eq("document_id", docId)
        .eq("tenant_id", resolvedTenantId)
        .eq("step", "indexing")
        .eq("status", "started")
        .gte("started_at", priorStartedAt);
      claimedByIngest = !claimEventErr && (count ?? 0) > 0;
    }
    if (shouldSkipLiveIngest(stampIsLive, claimedByIngest)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_processing" });
    }

    // Optimistic claim — only one concurrent ingest should pass this update.
    let claimQuery = db.from("documents").update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      last_error: null,
      last_error_step: null,
    }).eq("id", docId).eq("tenant_id", resolvedTenantId);
    claimQuery = priorStartedAt
      ? claimQuery.eq("processing_started_at", priorStartedAt)
      : claimQuery.is("processing_started_at", null);
    const { data: claimed } = await claimQuery.select("id").maybeSingle();
    if (!claimed) {
      return NextResponse.json({ ok: true, skipped: true, reason: "concurrent_claim" });
    }

    await logDocumentProcessingEvent({
      tenantId: resolvedTenantId,
      documentId: docId,
      step: "indexing",
      status: "started",
      worker: "portal:documents-ingest",
    });

    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const driveFileId = doc.drive_file_id ?? (meta.drive_file_id as string | undefined);
    const storagePath = typeof meta.storage_path === "string" ? meta.storage_path : null;
    let fileSizeHint = typeof meta.size === "number" ? meta.size : null;
    const projectIdForSplit = doc.project_id as string | null;
    const storageBucket = resolveDocumentStorageBucket(meta);

    if (!driveFileId && !storagePath) {
      const message = "Document has no source (no drive_file_id or storage_path)";
      await markError(message, "source");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Resolve Drive file size before downloading when meta.size is missing.
    if (driveFileId && fileSizeHint === null) {
      const driveToken = accessToken ?? await getAccessToken(resolvedTenantId, userId);
      if (driveToken) {
        const resolvedSize = await fetchDriveFileSize(driveFileId, driveToken);
        if (resolvedSize != null) {
          fileSizeHint = resolvedSize;
          await db.from("documents").update({
            meta: { ...meta, size: resolvedSize },
          }).eq("id", docId).eq("tenant_id", resolvedTenantId);
        }
      }
    }

    const fileName = typeof doc.file_name === "string" ? doc.file_name : "";
    const contentType = typeof meta.content_type === "string" ? meta.content_type : null;
    const pdfDocument = looksLikePdf(fileName, contentType);

    // Plan PDFs that need async split: never download into this Vercel function.
    // Drive → page-split-worker (streams from Drive); local → after()-kicked split.
    if (projectIdForSplit && shouldAsyncSplitPdf(fileName, fileSizeHint)) {
      if (driveFileId) {
        const queued = await queueDriveDocumentForPageSplit({
          tenantId: resolvedTenantId,
          userId,
          projectId: projectIdForSplit,
          driveFileId,
          fileName,
          mimeType: contentType ?? "application/pdf",
          sizeBytes: fileSizeHint,
          rekickIfStuck: true,
        });
        if (!queued.ok) {
          await markError(queued.error, "split");
          return NextResponse.json({ error: queued.error, code: queued.code }, { status: queued.status });
        }
        return NextResponse.json({
          ok: true,
          queued: queued.queued,
          reason: "large_plan_set_drive",
          document_id: queued.documentId,
          status: queued.status,
          bytes: fileSizeHint,
        }, { status: queued.queued ? 202 : 200 });
      }
      if (storagePath) {
        await queueLocalDocumentForPageSplit({
          tenantId: resolvedTenantId,
          userId,
          projectId: projectIdForSplit,
          documentId: docId,
          originalPath: storagePath,
        });
        return NextResponse.json({
          ok: true,
          queued: true,
          reason: "large_plan_set_local",
          bytes: fileSizeHint,
        }, { status: 202 });
      }
    }

    await assertWithinBudget("pre_download");

    // 1. Download PDF from Drive or Supabase Storage
    let pdfBytes: Buffer;

    if (driveFileId) {
      const driveToken = accessToken ?? await getAccessToken(resolvedTenantId, userId);
      if (!driveToken) {
        const message = "Google Drive is not connected. Connect Google in Settings.";
        await markError(message, "drive_auth");
        return NextResponse.json({
          error: message,
          code: "NEED_GOOGLE",
        }, { status: 412 });
      }
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${driveToken}` } },
      );
      if (!driveRes.ok) {
        await markError(`Drive download failed (${driveRes.status})`, "download");
        return NextResponse.json({ error: `Drive download failed (${driveRes.status})` }, { status: 502 });
      }
      pdfBytes = Buffer.from(await driveRes.arrayBuffer());
    } else {
      // Local file stored in Supabase Storage
      const { data: signed, error: signErr } = await db.storage
        .from(storageBucket)
        .createSignedUrl(storagePath!, 300);
      if (signErr || !signed?.signedUrl) {
        await markError(signErr?.message ?? "Could not access stored file", "download");
        return NextResponse.json({ error: "Could not access stored file" }, { status: 500 });
      }
      const storageRes = await fetch(signed.signedUrl);
      if (!storageRes.ok) {
        await markError(`Storage download failed (${storageRes.status})`, "download");
        return NextResponse.json({ error: `Storage download failed (${storageRes.status})` }, { status: 502 });
      }
      pdfBytes = Buffer.from(await storageRes.arrayBuffer());
    }

    if (pdfDeclaresEncryption(pdfBytes)) {
      const unlocked = await unlockPdf(pdfBytes, pdfPassword);
      if (!unlocked.ok) {
        await markError(unlocked.message, "download");
        return NextResponse.json({ error: unlocked.message, code: unlocked.code }, { status: 422 });
      }
      pdfBytes = Buffer.from(unlocked.bytes);
      if (storagePath) {
        const { error: replaceErr } = await db.storage.from(storageBucket).upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        if (replaceErr) {
          await markError(replaceErr.message, "download");
          return NextResponse.json({ error: replaceErr.message }, { status: 500 });
        }
      }
    }

    await assertWithinBudget("download");

    // Late size discovery: meta.size was missing/wrong but file is actually large.
    if (projectIdForSplit && pdfBytes.length >= ASYNC_SPLIT_BYTES) {
      if (storagePath) {
        await queueLocalDocumentForPageSplit({
          tenantId: resolvedTenantId,
          userId,
          projectId: projectIdForSplit,
          documentId: docId,
          originalPath: storagePath,
        });
        return NextResponse.json({
          ok: true,
          queued: true,
          reason: "large_plan_set_discovered",
          bytes: pdfBytes.length,
        }, { status: 202 });
      }
      if (driveFileId) {
        // Stage bytes to plans-bucket then split locally — avoids re-download with a stale token.
        const stagedPath = `originals/${docId}.pdf`;
        const { error: upErr } = await db.storage
          .from(PLANS_BUCKET)
          .upload(stagedPath, pdfBytes, { contentType: "application/pdf", upsert: true });
        if (upErr) {
          await markError(`Could not stage large Drive PDF: ${upErr.message}`, "split");
          return NextResponse.json({ error: upErr.message }, { status: 500 });
        }
        await db.from("documents").update({
          meta: { ...meta, storage: PLANS_BUCKET, storage_path: stagedPath, size: pdfBytes.length },
        }).eq("id", docId).eq("tenant_id", resolvedTenantId);
        await queueLocalDocumentForPageSplit({
          tenantId: resolvedTenantId,
          userId,
          projectId: projectIdForSplit,
          documentId: docId,
          originalPath: stagedPath,
        });
        return NextResponse.json({
          ok: true,
          queued: true,
          reason: "large_plan_set_staged",
          bytes: pdfBytes.length,
        }, { status: 202 });
      }
      const message = "Plan set is too large for synchronous ingest and could not be queued for page split.";
      await markError(message, "split");
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (pdfDocument && projectIdForSplit) {
      await assertWithinBudget("sheet_pages");
      await publishSheetPages({
        async countExisting(documentId, tenantId) {
          const { count, error } = await db
            .from("document_pages")
            .select("id", { count: "exact", head: true })
            .eq("document_id", documentId)
            .eq("tenant_id", tenantId);
          if (error) throw new Error(`document_pages count failed: ${error.message}`);
          return count ?? 0;
        },
        async uploadPage(storagePathForPage, bytes) {
          const { error } = await db.storage.from(PLANS_BUCKET).upload(storagePathForPage, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
          if (error) throw new Error(`sheet upload failed: ${error.message}`);
        },
        async insertPages(rows) {
          const { error } = await db.from("document_pages").upsert(rows, {
            onConflict: "document_id,page_number",
          });
          if (error) throw new Error(`document_pages upsert failed: ${error.message}`);
        },
      }, {
        tenantId: resolvedTenantId,
        documentId: docId,
        pdfBytes,
      });
    }

    // Embedded page text only. A scanned sheet with no text layer stays unread.
    let pdfPageCount = 0;
    try {
      const parsedPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      pdfPageCount = parsedPdf.getPageCount();
    } catch {
      pdfPageCount = 0;
    }
    let extraction: ExtractionResult = {
      doc_type: "other",
      page_count: pdfPageCount,
      title: "",
      pages: [],
    };
    try {
      await assertWithinBudget("local_text");
      const localPages = await readPdfPageText(pdfBytes);
      extraction = extractionFromPageText(localPages, pdfPageCount) as ExtractionResult;
    } catch {
      extraction = { doc_type: "other", page_count: pdfPageCount, title: "", pages: [] };
    }
    if (pdfPageCount === 0 && extraction.pages.length === 0) {
      throw new Error("This PDF has no pages.");
    }

    const docType = normalizeDocumentClass(extraction.doc_type);
    const pages = extraction.pages ?? [];
    const missingPages = missingPageNumbers(pdfPageCount, pages.map((page) => page.page_number));
    const pageCount = pdfPageCount > 0 ? pdfPageCount : pages.length;

    // 5. Update doc with classification
    await db.from("documents").update({
      doc_type: docType,
      page_count: pageCount,
      meta: {
        ...meta,
        title: extraction.title ?? null,
        processing_summary: {
          pages_total: pageCount,
          pages_summarized: pages.length,
          missing_page_numbers: missingPages,
          reader: "local",
        },
      },
    }).eq("id", docId).eq("tenant_id", resolvedTenantId);

    // 6. Insert pages
    if (pages.length > 0) {
      const pageRows: TablesInsert<"pages">[] = pages.map((p) => ({
        document_id: docId,
        tenant_id: resolvedTenantId,
        page_number: p.page_number,
        extracted_text: [p.summary, (p.key_terms ?? []).join(", ")].filter(Boolean).join("\n"),
      }));
      const { error: upsertErr } = await db.from("pages").upsert(pageRows, { onConflict: "document_id,page_number" });
      if (upsertErr) throw new Error(`Pages upsert failed: ${upsertErr.message}`);
    }

    // Text is stored for search. Embeddings are not required to finish the file.
    const projectId = doc.project_id as string;
    const chunkRows: TablesInsert<"chunks">[] = [];
    for (const page of pages) {
      const text = `${page.summary}\nKey terms: ${(page.key_terms ?? []).join(", ")}`;
      for (const chunk of splitChunks(text)) {
        chunkRows.push({
          document_id: docId,
          tenant_id: resolvedTenantId,
          project_id: projectId,
          page_number: page.page_number,
          content: chunk,
        });
      }
    }

    if (chunkRows.length > 0) {
      const { error: chunksErr } = await db.from("chunks").insert(chunkRows);
      if (chunksErr) throw new Error(`Chunks insert failed: ${chunksErr.message}`);
    }

    let geometryMeasured = false;
    let unscaledPages: number[] = [];
    if (pdfDocument && pdfBytes.byteLength > 0) {
      try {
        const measured = await measurePdfBytes(pdfBytes);
        const { data: sheetRows, error: sheetErr } = await db.from("document_pages")
          .select("id, page_number")
          .eq("document_id", docId)
          .eq("tenant_id", resolvedTenantId);
        if (sheetErr) throw new Error(sheetErr.message);
        const byNumber = new Map((sheetRows ?? []).map((row) => [row.page_number, row.id]));
        unscaledPages = await saveMeasuredPages(db as never, {
          tenantId: resolvedTenantId,
          projectId,
          documentId: docId,
          pages: measured.flatMap((sheet) => {
            const id = byNumber.get(sheet.pageNumber);
            return id ? [{ id, pageNumber: sheet.pageNumber, measured: sheet }] : [];
          }),
        });
        geometryMeasured = true;
      } catch (measureErr) {
        console.error("[ingest] geometry measurement will retry", measureErr);
      }
    }

    const finalStatus = geometryMeasured || missingPages.length === 0 ? "complete" : "processing";
    await db.from("documents").update({
      status: finalStatus,
      processed_at: geometryMeasured || missingPages.length === 0 ? new Date().toISOString() : null,
      last_error: !geometryMeasured && missingPages.length > 0 ? `Missing pages: ${missingPages.join(", ")}` : null,
      last_error_step: !geometryMeasured && missingPages.length > 0 ? "parse" : null,
      ...(geometryMeasured ? { takeoff_status: "done" } : {}),
      meta: {
        ...meta,
        title: extraction.title ?? null,
        processing_summary: {
          pages_total: pageCount,
          pages_summarized: pages.length,
          missing_page_numbers: missingPages,
          reader: "local",
          geometry_measured: geometryMeasured,
          unscaled_pages: unscaledPages,
          takeoff_done: geometryMeasured,
        },
      },
    }).eq("id", docId).eq("tenant_id", resolvedTenantId);

    await logDocumentProcessingEvent({
      tenantId: resolvedTenantId,
      projectId,
      documentId: docId,
      step: "indexing",
      status: "succeeded",
      worker: "portal:documents-ingest",
    });

    void logEvent({
      projectId: projectId,
      tenantId: resolvedTenantId,
      userId,
      entityType: "document",
      entityId: docId,
      action: "processed",
      title: `Document indexed: ${doc.file_name}`,
      meta: { doc_type: docType, page_count: pageCount, chunk_count: chunkRows.length },
    });

    return NextResponse.json({ ok: true, doc_type: docType, page_count: pageCount, chunk_count: chunkRows.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(msg, "ingest");
    if (tenantId) {
      await logDocumentProcessingEvent({
        tenantId,
        documentId: docId,
        step: "indexing",
        status: "failed",
        worker: "portal:documents-ingest",
        errorCode: "ingest_failed",
        errorMessage: msg,
      });
    }
    console.error(`[ingest ${docId}] ${msg}`);
    return NextResponse.json(
      { error: `[POST /api/documents/${docId}/ingest] ${msg}` },
      { status: 500 },
    );
  }
}
