import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { getAccessToken } from "@/lib/google/oauth";
import { logEvent } from "@/lib/activity";
import { requireEnv } from "@/lib/env";
import { fetchGemini, readGeminiError } from "@/lib/ai/gemini";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { fetchDriveFileSize } from "@/lib/google/driveFile";
import { resolveDocumentStorageBucket } from "@/lib/documents/storage";
import { looksLikePdf, publishSheetPages } from "@/lib/documents/sheet-pages";
import {
  PLANS_BUCKET,
  ASYNC_SPLIT_BYTES,
  shouldAsyncSplitPdf,
  queueDriveDocumentForPageSplit,
  queueLocalDocumentForPageSplit,
} from "@/lib/documents/queuePageSplit";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMBED_MODEL = "text-embedding-004";
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? "gemini-2.0-flash-001";
/** Leave headroom under Vercel maxDuration=300 so we can write error status before kill. */
const INGEST_BUDGET_MS = 270_000;
/** Skip duplicate fire-and-forget ingest while another run is in-flight. */
const CONCURRENT_INGEST_MS = INGEST_BUDGET_MS;
const TERMINAL_STATUSES = new Set(["complete", "ready", "done"]);

function geminiApiKey(): string {
  return requireEnv("GEMINI_API_KEY");
}

const EXTRACTION_PROMPT = `Analyze this construction document and return ONLY a JSON object with this exact structure — no markdown, no explanation:
{
  "doc_type": "<one of: drawing, spec, rfi, submittal, other>",
  "page_count": <integer>,
  "title": "<document title or main subject>",
  "pages": [
    {
      "page_number": 1,
      "summary": "<2-4 sentences describing this page: what it shows/contains, key identifiers such as sheet numbers, spec section numbers, room names, dimensions, materials, or notable content>",
      "key_terms": ["<term1>", "<term2>", "<term3>"]
    }
  ]
}

Classification:
- drawing: architectural/structural/MEP/civil drawings, floor plans, elevations, sections, details, site plans
- spec: CSI specifications, division sections, material/installation requirements, standards
- rfi: request for information forms or RFI logs
- submittal: submittal forms, shop drawings, product data sheets, cut sheets
- other: contracts, change orders, reports, schedules, correspondence, meeting minutes`;

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

async function uploadToGeminiFiles(
  pdfBytes: Buffer,
  fileName: string,
): Promise<{ uri: string; name: string }> {
  const boundary = "onyx_boundary_gemini";
  const meta = JSON.stringify({ file: { displayName: fileName } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n`),
    Buffer.from(meta),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
    pdfBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetchGemini(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart`,
    {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": geminiApiKey(),
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
    { label: "Gemini Files upload", timeoutMs: 60_000 },
  );
  if (!res.ok) {
    await readGeminiError(res, "Gemini Files upload");
  }
  const data = (await res.json()) as { file: { name: string; uri: string; state: string } };
  return { uri: data.file.uri, name: data.file.name };
}

async function waitForActive(geminiName: string, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await fetchGemini(
      `https://generativelanguage.googleapis.com/v1beta/${geminiName}`,
      { headers: { "X-Goog-Api-Key": geminiApiKey() } },
      { label: "Gemini file status", timeoutMs: 20_000 },
    );
    const data = (await res.json()) as { state: string };
    if (data.state === "ACTIVE") return;
    if (data.state === "FAILED") throw new Error("Gemini file processing failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Gemini file did not become active within 60 s");
}

async function deleteGeminiFile(geminiName: string): Promise<void> {
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiName}`, {
    method: "DELETE",
    headers: { "X-Goog-Api-Key": geminiApiKey() },
  }).catch(() => {});
}

async function embedText(text: string): Promise<number[]> {
  const values = await embedBatch([text]);
  if (!values[0]) throw new Error("Gemini embedding returned empty values");
  return values[0];
}

/** Batch-embed texts via Gemini batchEmbedContents (same path as page-processor). */
async function embedBatch(inputs: string[]): Promise<Array<number[] | null>> {
  if (inputs.length === 0) return [];
  const res = await fetchGemini(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${geminiApiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: inputs.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
        })),
      }),
    },
    { label: "Gemini batch embedding", timeoutMs: 60_000 },
  );
  if (!res.ok) await readGeminiError(res, "Gemini batch embedding");
  const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
  return (data.embeddings ?? []).map((e) => (Array.isArray(e?.values) ? e.values : null));
}


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: docId } = await params;
  let geminiName: string | null = null;
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
    try {
      geminiApiKey();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 503 });
    }

    const body = await req.json().catch(() => ({})) as { access_token?: string };
    const accessToken = body.access_token; // optional — server falls back to stored token

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
    const activeIngest = doc.status === "processing"
      && priorStartedAt
      && Date.now() - new Date(priorStartedAt).getTime() < CONCURRENT_INGEST_MS;
    if (activeIngest) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_processing" }, { status: 409 });
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
      return NextResponse.json({ ok: true, skipped: true, reason: "concurrent_claim" }, { status: 409 });
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

    // 2. Upload to Gemini Files API
    await assertWithinBudget("gemini_upload");
    const { uri: fileUri, name: gName } = await uploadToGeminiFiles(pdfBytes, doc.file_name);
    geminiName = gName;

    // 3. Wait for ACTIVE
    await assertWithinBudget("gemini_active");
    await waitForActive(geminiName);

    // 4. Extract text + classify
    await assertWithinBudget("extraction");
    const extractRes = await fetchGemini(
      `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${geminiApiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { fileData: { mimeType: "application/pdf", fileUri: fileUri } },
              { text: EXTRACTION_PROMPT },
            ],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
      { label: "Gemini document extraction", timeoutMs: 60_000 },
    );
    if (!extractRes.ok) {
      await readGeminiError(extractRes, "Gemini document extraction");
    }
    const extractData = (await extractRes.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const rawJson = extractData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let extraction: ExtractionResult;
    try {
      extraction = JSON.parse(rawJson) as ExtractionResult;
    } catch {
      throw new Error(`Gemini returned non-JSON extraction payload: ${rawJson.slice(0, 200)}`);
    }

    const VALID_TYPES = ["drawing", "spec", "rfi", "submittal", "other"] as const;
    const docType = VALID_TYPES.includes(extraction.doc_type as (typeof VALID_TYPES)[number])
      ? extraction.doc_type
      : "other";
    const pageCount = extraction.page_count ?? extraction.pages?.length ?? 0;
    const pages = extraction.pages ?? [];

    // 5. Update doc with classification
    await db.from("documents").update({
      doc_type: docType,
      page_count: pageCount,
      meta: { ...meta, title: extraction.title ?? null, gemini_file_uri: fileUri },
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

    // 7. Chunk + embed via batchEmbedContents (one API call per page-batch,
    // not one call per chunk). Caps request size to stay within rate limits.
    const projectId = doc.project_id as string;
    const chunkRows: TablesInsert<"chunks">[] = [];

    type PendingChunk = { page_number: number; content: string };
    const pending: PendingChunk[] = [];
    for (const page of pages) {
      const text = `${page.summary}\nKey terms: ${(page.key_terms ?? []).join(", ")}`;
      for (const chunk of splitChunks(text)) {
        pending.push({ page_number: page.page_number, content: chunk });
      }
    }

    // Prefer a partial flush + 504 over throwing so completed embeds are kept.
    const EMBED_BATCH = 16;
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      await assertWithinBudget("embedding");
      if (Date.now() - startedAt > INGEST_BUDGET_MS) {
        if (chunkRows.length > 0) {
          const { error: partialErr } = await db.from("chunks").insert(chunkRows);
          if (partialErr) throw new Error(`Chunks insert failed: ${partialErr.message}`);
        }
        const message = `Ingest stopped after ${Math.round((Date.now() - startedAt) / 1000)}s with ${chunkRows.length} chunks saved. Re-run page split for the remaining sheets.`;
        await markError(message, "ingest_timeout");
        return NextResponse.json({ error: message, partial_chunks: chunkRows.length }, { status: 504 });
      }
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        const values = vectors[j];
        if (!values) {
          // Fall back to single-embed for any slot the batch response omitted.
          const solo = await embedText(batch[j].content);
          chunkRows.push({
            document_id: docId,
            tenant_id: resolvedTenantId,
            project_id: projectId,
            page_number: batch[j].page_number,
            content: batch[j].content,
            embedding: `[${solo.join(",")}]` as unknown as never,
          });
          continue;
        }
        chunkRows.push({
          document_id: docId,
          tenant_id: resolvedTenantId,
          project_id: projectId,
          page_number: batch[j].page_number,
          content: batch[j].content,
          embedding: `[${values.join(",")}]` as unknown as never,
        });
      }
      // Checkpoint progress so a timeout/retry can see how far we got.
      await db.from("documents").update({
        meta: {
          ...meta,
          title: extraction.title ?? null,
          gemini_file_uri: fileUri,
          ingest_progress: {
            chunks_embedded_through: Math.min(i + EMBED_BATCH, pending.length),
            chunks_total: pending.length,
            updated_at: new Date().toISOString(),
          },
        },
      }).eq("id", docId).eq("tenant_id", resolvedTenantId);
    }

    if (chunkRows.length > 0) {
      const { error: chunksErr } = await db.from("chunks").insert(chunkRows);
      if (chunksErr) throw new Error(`Chunks insert failed: ${chunksErr.message}`);
    }

    // 8. Mark complete
    await db.from("documents").update({
      status: "complete",
      processed_at: new Date().toISOString(),
    }).eq("id", docId).eq("tenant_id", resolvedTenantId);

    // 9. Cleanup Gemini file (best effort)
    await deleteGeminiFile(geminiName);
    geminiName = null;
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
    if (geminiName) await deleteGeminiFile(geminiName);
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
