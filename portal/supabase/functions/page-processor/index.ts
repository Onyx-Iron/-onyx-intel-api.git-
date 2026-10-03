// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Pipeline:
//   1. Download single-page PDF bytes from storage.
//   2. If ENABLE_DOCLING + PYTHON_API_URL: density-check via pdfplumber
//      (/api/parse/document); when text-rich, try Docling Markdown.
//   3. Else / on Docling miss: Gemini generateContent OCR (drawings/scans).
//   4. Chunk (~1200 / 200 overlap) → embed → insert document_chunks with meta.
//   5. Mark document_pages.status="done" and stash ocr_text.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
//   PLANS_BUCKET (default "plans-bucket"),
//   GEMINI_TEXT_MODEL  (default "gemini-2.5-pro"),
//   GEMINI_EMBED_MODEL (default "text-embedding-004"),
//   PYTHON_API_URL, ONYX_API_SECRET (optional Docling path),
//   ENABLE_DOCLING (try Docling when density high),
//   DOCLING_MIN_CHARS (default 400).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureException } from "../_shared/errors.ts";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY     = Deno.env.get("GEMINI_API_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
const TEXT_MODEL         = Deno.env.get("GEMINI_TEXT_MODEL") ?? "gemini-2.5-pro";
const EMBED_MODEL        = Deno.env.get("GEMINI_EMBED_MODEL") ?? "text-embedding-004";
const PYTHON_API_URL     = (Deno.env.get("PYTHON_API_URL") ?? "").replace(/\/$/, "");
const ONYX_API_SECRET    = Deno.env.get("ONYX_API_SECRET") ?? "";
const TRY_DOCLING        = ["1", "true", "yes", "on"].includes(
  (Deno.env.get("ENABLE_DOCLING") ?? "").trim().toLowerCase(),
);
const DOCLING_MIN_CHARS  = Number(Deno.env.get("DOCLING_MIN_CHARS") ?? "400") || 400;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface ChunkMeta {
  parser_id: "docling" | "gemini" | "pdfplumber";
  confidence: number | null;
  heading_path: string[] | null;
  bbox: null;
  source: "page-processor";
  density_chars?: number;
}

interface ExtractedText {
  text: string;
  parserId: ChunkMeta["parser_id"];
  headings: string[];
  densityChars: number | null;
  confidence: number | null;
}

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3, timeoutMs = 45_000): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(`timeout after ${timeoutMs} ms`), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

interface Payload {
  page_id: string;
  document_id: string;
  tenant_id: string;
  project_id?: string;
  page_number: number;
  storage_path: string;
}

Deno.serve(async (req) => {
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let projectId = body.project_id ?? null;
  if (!projectId) {
    const { data: docRow } = await db.from("documents")
      .select("project_id")
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .maybeSingle();
    projectId = (docRow?.project_id as string | null) ?? null;
  }

  async function recordEvent(step: "ocr" | "embedding", status: "started" | "succeeded" | "failed" | "skipped", errorMessage?: string): Promise<void> {
    await db.from("document_processing_events").insert({
      tenant_id: body.tenant_id,
      project_id: projectId,
      document_id: body.document_id,
      document_page_id: body.page_id,
      step,
      status,
      worker: "page-processor",
      error_message: errorMessage?.slice(0, 2000) ?? null,
      completed_at: status === "started" ? null : new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }
  async function refreshDocumentSummary(): Promise<void> {
    const { error } = await db.rpc("refresh_document_processing_summary", {
      p_document_id: body.document_id,
    });
    if (error) console.warn("[page-processor] summary refresh failed", error.message);
  }

  await db.from("document_pages")
    .update({ status: "processing" })
    .eq("id", body.page_id)
    .eq("tenant_id", body.tenant_id);
  await recordEvent("ocr", "started");

  try {
    // ── 1. Download page bytes ──────────────────────────────────────────────
    const dl = await db.storage.from(PLANS_BUCKET).download(body.storage_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);
    const pageBlob = dl.data;

    // ── 2. Extract text: Docling (text-rich) → Gemini fallback ───────────────
    const extracted = await extractPageText(pageBlob, body);

    // ── 3. Chunk ────────────────────────────────────────────────────────────
    const chunks = chunkText(extracted.text, 1200, 200);
    if (chunks.length === 0) {
      await db.from("document_pages")
        .update({ status: "done", ocr_text: extracted.text || null, updated_at: new Date().toISOString() })
        .eq("id", body.page_id);
      await recordEvent("ocr", "succeeded", `parser=${extracted.parserId}; empty`);
      await recordEvent("embedding", "skipped", "no chunks extracted");
      await refreshDocumentSummary();
      return new Response(JSON.stringify({
        ok: true,
        page_id: body.page_id,
        chunks: 0,
        parser_id: extracted.parserId,
      }), { status: 200 });
    }

    // ── 4. Embed ────────────────────────────────────────────────────────────
    await recordEvent("embedding", "started");
    const embeddings = await embedBatch(chunks);
    const embeddedCount = embeddings.filter((e) => Array.isArray(e) && e.length > 0).length;
    if (embeddedCount === 0) {
      throw new Error(`embedBatch returned no usable vectors for ${chunks.length} chunk(s)`);
    }

    // ── 5. Insert with XD-02 meta provenance ────────────────────────────────
    const rows = chunks
      .map((content, i) => {
        const heading_path = headingPathForChunk(extracted.text, content, extracted.headings);
        const meta: ChunkMeta = {
          parser_id: extracted.parserId,
          confidence: extracted.confidence,
          heading_path: heading_path.length ? heading_path : null,
          bbox: null,
          source: "page-processor",
          ...(extracted.densityChars != null ? { density_chars: extracted.densityChars } : {}),
        };
        return {
          id: crypto.randomUUID(),
          tenant_id: body.tenant_id,
          document_id: body.document_id,
          page_id: body.page_id,
          page_number: body.page_number,
          chunk_index: i,
          content,
          embedding: embeddings[i] ?? null,
          meta,
        };
      })
      .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
    if (rows.length === 0) {
      throw new Error("no chunks with embeddings to insert");
    }
    const { error: insErr } = await db.from("document_chunks").insert(rows);
    if (insErr) throw new Error(`insert chunks: ${insErr.message}`);

    // ── 6. Done ─────────────────────────────────────────────────────────────
    const embedNote = embeddedCount < chunks.length
      ? `${chunks.length - embeddedCount} chunk embed(s) dropped; parser=${extracted.parserId}`
      : `parser=${extracted.parserId}`;
    await db.from("document_pages")
      .update({ status: "done", ocr_text: extracted.text, updated_at: new Date().toISOString() })
      .eq("id", body.page_id);
    await recordEvent("ocr", "succeeded", `parser=${extracted.parserId}`);
    await recordEvent("embedding", "succeeded", embedNote);
    await refreshDocumentSummary();

    return new Response(JSON.stringify({
      ok: true,
      page_id: body.page_id,
      chunks: rows.length,
      chunks_requested: chunks.length,
      embeds_missing: chunks.length - embeddedCount,
      parser_id: extracted.parserId,
    }), { status: 200 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    captureException(err, { fn: "page-processor" });
    console.error("[page-processor]", err);
    const message = String(err?.message ?? err);
    await recordEvent("ocr", "failed", message);
    await db.from("document_pages")
      .update({ status: "error", error: String(err?.message ?? err).slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", body.page_id);
    await refreshDocumentSummary();
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 });
  }
});

// ── extract paths ────────────────────────────────────────────────────────────

async function extractPageText(pageBlob: Blob, body: Payload): Promise<ExtractedText> {
  const docling = await tryDoclingExtract(pageBlob, body);
  if (docling) return docling;
  return await extractWithGemini(pageBlob);
}

async function tryDoclingExtract(pageBlob: Blob, body: Payload): Promise<ExtractedText | null> {
  if (!TRY_DOCLING || !PYTHON_API_URL) return null;
  try {
    // Density probe (pdfplumber) — skip Docling on drawing-like pages.
    const densForm = new FormData();
    densForm.append("file", pageBlob, `page-${body.page_number}.pdf`);
    const densRes = await fetchWithRetry(`${PYTHON_API_URL}/api/parse/document`, {
      method: "POST",
      headers: {
        "X-Onyx-Secret": ONYX_API_SECRET,
        "X-Onyx-Tenant": body.tenant_id,
        ...(body.project_id ? { "X-Onyx-Project": body.project_id } : {}),
      },
      body: densForm,
    }, 2, 30_000);
    if (!densRes.ok) {
      console.warn(`[page-processor] density probe ${densRes.status}`);
      return null;
    }
    const densJson = await densRes.json() as {
      text_preview?: string | null;
      text_density?: { char_count?: number; is_text_rich?: boolean };
    };
    const charCount = densJson.text_density?.char_count
      ?? (densJson.text_preview?.length ?? 0);
    const rich = densJson.text_density?.is_text_rich
      ?? (charCount >= DOCLING_MIN_CHARS);
    if (!rich) {
      console.log(`[page-processor] skip Docling — low text density chars=${charCount}`);
      return null;
    }

    const form = new FormData();
    form.append("file", pageBlob, `page-${body.page_number}.pdf`);
    const res = await fetchWithRetry(`${PYTHON_API_URL}/api/parse/docling`, {
      method: "POST",
      headers: {
        "X-Onyx-Secret": ONYX_API_SECRET,
        "X-Onyx-Tenant": body.tenant_id,
        ...(body.project_id ? { "X-Onyx-Project": body.project_id } : {}),
      },
      body: form,
    }, 2, 60_000);
    if (!res.ok) {
      console.warn(`[page-processor] docling ${res.status}`);
      return null;
    }
    const json = await res.json() as {
      status?: string;
      markdown?: string | null;
      text_preview?: string | null;
      metadata?: { headings?: string[]; markdown_chars?: number };
    };
    if (json.status !== "parsed") {
      console.log(`[page-processor] docling status=${json.status} — fallback Gemini`);
      return null;
    }
    const text = (json.markdown ?? json.text_preview ?? "").trim();
    if (!text) return null;
    const headings = Array.isArray(json.metadata?.headings) ? json.metadata!.headings! : [];
    const mdChars = json.metadata?.markdown_chars ?? text.length;
    return {
      text,
      parserId: "docling",
      headings,
      densityChars: charCount,
      confidence: Math.min(0.95, 0.55 + Math.min(mdChars, 4000) / 8000),
    };
  } catch (err) {
    console.warn("[page-processor] Docling path failed, falling back to Gemini", err);
    return null;
  }
}

async function extractWithGemini(pageBlob: Blob): Promise<ExtractedText> {
  const arrayBuf = await pageBlob.arrayBuffer();
  const b64 = base64Encode(new Uint8Array(arrayBuf));
  const genBody = {
    contents: [{
      role: "user",
      parts: [
        { text: "Extract all readable text from this construction plan sheet. Preserve line breaks and tabular structure. Return raw text only." },
        { inlineData: { mimeType: "application/pdf", data: b64 } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };

  const genRes = await fetchWithRetry(
    `${GEMINI_BASE}/models/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify(genBody),
    },
  );
  if (!genRes.ok) {
    const errText = (await genRes.text().catch(() => "")).slice(0, 500);
    throw new Error(`gemini generate ${genRes.status}: ${errText}`);
  }
  const genJson = await genRes.json();
  const text: string = (genJson.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? "")
    .join("")
    .trim();
  return {
    text,
    parserId: "gemini",
    headings: [],
    densityChars: null,
    confidence: text ? 0.7 : null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function headingPathForChunk(fullText: string, chunk: string, docHeadings: string[]): string[] {
  if (docHeadings.length === 0 && !fullText.includes("#")) return [];
  const idx = fullText.indexOf(chunk.slice(0, Math.min(80, chunk.length)));
  const prefix = idx >= 0 ? fullText.slice(0, idx) : "";
  const trail: string[] = [];
  for (const line of prefix.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("#")) continue;
    const level = s.match(/^#+/)?.[0].length ?? 1;
    const title = s.replace(/^#+\s*/, "").trim();
    if (!title) continue;
    while (trail.length >= level) trail.pop();
    trail.push(title);
  }
  if (trail.length > 0) return trail.slice(-4);
  // Fallback: first document-level headings from Docling metadata.
  return docHeadings.slice(0, 3);
}

function chunkText(text: string, size: number, overlap: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    let cut = end;
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + size / 2) cut = nl;
    }
    out.push(text.slice(i, cut).trim());
    if (cut >= text.length) break;
    i = Math.max(cut - overlap, i + 1);
  }
  return out.filter((c) => c.length > 0);
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

async function embedBatch(inputs: string[]): Promise<Array<number[] | null>> {
  const body = {
    requests: inputs.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    })),
  };
  const res = await fetchWithRetry(
    `${GEMINI_BASE}/models/${EMBED_MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.warn(`[embed] batchEmbedContents ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return inputs.map(() => null);
  }
  const json = await res.json();
  return (json.embeddings ?? []).map((e: any) => (Array.isArray(e?.values) ? e.values : null));
}
