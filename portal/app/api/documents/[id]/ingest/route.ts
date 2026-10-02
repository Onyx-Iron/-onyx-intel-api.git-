import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getAccessToken } from "@/lib/google/oauth";
import { logEvent } from "@/lib/activity";
import { requireEnv } from "@/lib/env";
import { fetchGemini, readGeminiError } from "@/lib/ai/gemini";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { invokePageSplitWorker } from "@/lib/documents/pageSplitWorker";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMBED_MODEL = "text-embedding-004";
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? "gemini-2.0-flash-001";
const PLANS_BUCKET = "plans-bucket";
const ASYNC_SPLIT_BYTES = 3.5 * 1024 * 1024;
const INGEST_BUDGET_MS = 240_000;

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
  const res = await fetchGemini(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${geminiApiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
      }),
    },
    { label: "Gemini embedding", timeoutMs: 45_000 },
  );
  if (!res.ok) await readGeminiError(res, "Gemini embedding");
  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: docId } = await params;
  let geminiName: string | null = null;
  let tenantId: string | null = null;

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

  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      geminiApiKey();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    const startedAt = Date.now();

    const body = await req.json().catch(() => ({})) as { access_token?: string };
    const accessToken = body.access_token; // optional — server falls back to stored token

    tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    // Narrowed const, since `tenantId` is captured by the markError() closure above,
    // which blocks TS's normal control-flow narrowing of the `let` for the rest of this function.
    const resolvedTenantId: string = tenantId;
    const db = await createServiceClient();
    await logDocumentProcessingEvent({
      tenantId: resolvedTenantId,
      documentId: docId,
      step: "indexing",
      status: "started",
      worker: "portal:documents-ingest",
    });

    const { data: doc, error: docErr } = await db
      .from("documents")
      .select("id, file_name, project_id, drive_file_id, meta")
      .eq("id", docId)
      .eq("tenant_id", tenantId)
      .single();
    if (docErr || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const driveFileId = doc.drive_file_id ?? (meta.drive_file_id as string | undefined);
    const storagePath = typeof meta.storage_path === "string" ? meta.storage_path : null;

    if (!driveFileId && !storagePath) {
      return NextResponse.json({ error: "Document has no source (no drive_file_id or storage_path)" }, { status: 400 });
    }

    // 1. Download PDF from Drive or Supabase Storage
    let pdfBytes: Buffer;

    if (driveFileId) {
      const driveToken = accessToken ?? await getAccessToken(tenantId, userId);
      if (!driveToken) {
        return NextResponse.json({
          error: "Google Drive is not connected. Connect Google in Settings.",
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
        .from(PLANS_BUCKET)
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

    const projectIdForSplit = doc.project_id as string | null;
    if (pdfBytes.length >= ASYNC_SPLIT_BYTES) {
      if (storagePath && projectIdForSplit) {
        await db.from("documents").update({
          status: "processing",
          split_status: "pending",
          processing_started_at: new Date().toISOString(),
          last_error: null,
          last_error_step: null,
        }).eq("id", docId).eq("tenant_id", tenantId);
        await invokePageSplitWorker({
          document_id: docId,
          tenant_id: resolvedTenantId,
          project_id: projectIdForSplit,
          original_path: storagePath,
          user_id: userId,
          is_local_upload: true,
        });
        return NextResponse.json({
          ok: true,
          queued: true,
          reason: "large_plan_set",
          bytes: pdfBytes.length,
        }, { status: 202 });
      }
      const message = "Plan set is too large for synchronous ingest. Upload it through takeoff so it can be split by page.";
      await markError(message, "split");
      return NextResponse.json({ error: message }, { status: 409 });
    }

    await db.from("documents").update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
    }).eq("id", docId).eq("tenant_id", tenantId);

    // 2. Upload to Gemini Files API
    const { uri: fileUri, name: gName } = await uploadToGeminiFiles(pdfBytes, doc.file_name);
    geminiName = gName;

    // 3. Wait for ACTIVE
    await waitForActive(geminiName);

    // 4. Extract text + classify
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
    }).eq("id", docId).eq("tenant_id", tenantId);

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

    // 7. Chunk + embed (batches of 8 to stay within rate limits)
    const projectId = doc.project_id as string;
    const chunkRows: TablesInsert<"chunks">[] = [];

    const BATCH = 8;
    for (let i = 0; i < pages.length; i += BATCH) {
      if (Date.now() - startedAt > INGEST_BUDGET_MS) {
        if (chunkRows.length > 0) {
          const { error: partialErr } = await db.from("chunks").insert(chunkRows);
          if (partialErr) throw new Error(`Chunks insert failed: ${partialErr.message}`);
        }
        const message = `Ingest stopped after ${Math.round((Date.now() - startedAt) / 1000)}s with ${chunkRows.length} chunks saved. Re-run page split for the remaining sheets.`;
        await markError(message, "ingest_timeout");
        return NextResponse.json({ error: message, partial_chunks: chunkRows.length }, { status: 504 });
      }
      const batch = pages.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (page) => {
          const text = `${page.summary}\nKey terms: ${(page.key_terms ?? []).join(", ")}`;
          const chunks = splitChunks(text);
          for (const chunk of chunks) {
            const values = await embedText(chunk);
            chunkRows.push({
              document_id: docId,
              tenant_id: resolvedTenantId,
              project_id: projectId,
              page_number: page.page_number,
              content: chunk,
              // pgvector accepts the vector literal string format
              embedding: `[${values.join(",")}]` as unknown as never,
            });
          }
        }),
      );
    }

    if (chunkRows.length > 0) {
      const { error: chunksErr } = await db.from("chunks").insert(chunkRows);
      if (chunksErr) throw new Error(`Chunks insert failed: ${chunksErr.message}`);
    }

    // 8. Mark complete
    await db.from("documents").update({
      status: "complete",
      processed_at: new Date().toISOString(),
    }).eq("id", docId).eq("tenant_id", tenantId);

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
      tenantId,
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
