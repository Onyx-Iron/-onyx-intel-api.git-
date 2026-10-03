// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Pipeline:
//   1. Download single-page PDF bytes from storage.
//   2. Send to Gemini via `generateContent` with inlineData
//      (base64-encoded PDF). NOTE: payload deliberately omits any
//      `display_name` field — Gemini's REST schema doesn't accept it and
//      rejects the whole request if present.
//   3. Chunk the extracted text (~1200 chars, 200-char overlap).
//   4. Embed each chunk with text-embedding-004.
//   5. Insert into `document_chunks` with page_id + page_number.
//   6. Update `document_pages.status="done"` and stash `ocr_text`.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
//   PLANS_BUCKET (default "plans-bucket"),
//   GEMINI_TEXT_MODEL  (default "gemini-2.5-pro"),
//   GEMINI_EMBED_MODEL (default "text-embedding-004").

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureException } from "../_shared/errors.ts";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY     = Deno.env.get("GEMINI_API_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
const TEXT_MODEL         = Deno.env.get("GEMINI_TEXT_MODEL") ?? "gemini-2.5-pro";
const EMBED_MODEL        = Deno.env.get("GEMINI_EMBED_MODEL") ?? "text-embedding-004";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Gemini calls occasionally 429/5xx under load; retry with exponential
// backoff rather than failing the whole page on a transient blip.
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
    const arrayBuf = await dl.data.arrayBuffer();
    const b64 = base64Encode(new Uint8Array(arrayBuf));

    // ── 2. Extract text via Gemini ───────────────────────────────────────────
    // Payload strictly omits `display_name` — the v1beta REST endpoint rejects
    // it (it exists only in the Files API, not inlineData parts).
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => p.text ?? "")
      .join("")
      .trim();

    // ── 3. Chunk ────────────────────────────────────────────────────────────
    const chunks = chunkText(text, 1200, 200);
    if (chunks.length === 0) {
      await db.from("document_pages")
        .update({ status: "done", ocr_text: text || null, updated_at: new Date().toISOString() })
        .eq("id", body.page_id);
      await recordEvent("ocr", "succeeded");
      await recordEvent("embedding", "skipped", "no chunks extracted");
      await refreshDocumentSummary();
      return new Response(JSON.stringify({ ok: true, page_id: body.page_id, chunks: 0 }), { status: 200 });
    }

    // ── 4. Embed (batched — text-embedding-004 supports batch mode) ─────────
    await recordEvent("embedding", "started");
    const embeddings = await embedBatch(chunks);
    const embeddedCount = embeddings.filter((e) => Array.isArray(e) && e.length > 0).length;
    if (embeddedCount === 0) {
      throw new Error(`embedBatch returned no usable vectors for ${chunks.length} chunk(s)`);
    }

    // ── 5. Insert chunks (skip slots with null embeddings rather than
    // claiming success with unsearchable null vectors) ───────────────────────
    const rows = chunks
      .map((content, i) => ({
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        document_id: body.document_id,
        page_id: body.page_id,
        page_number: body.page_number,
        chunk_index: i,
        content,
        embedding: embeddings[i] ?? null,
      }))
      .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
    if (rows.length === 0) {
      throw new Error("no chunks with embeddings to insert");
    }
    const { error: insErr } = await db.from("document_chunks").insert(rows);
    if (insErr) throw new Error(`insert chunks: ${insErr.message}`);

    // ── 6. Done ─────────────────────────────────────────────────────────────
    // Partial embed success still marks the page done for OCR, but records
    // how many chunks were dropped so ops can see search coverage gaps.
    const embedNote = embeddedCount < chunks.length
      ? `${chunks.length - embeddedCount} chunk embed(s) dropped`
      : undefined;
    await db.from("document_pages")
      .update({ status: "done", ocr_text: text, updated_at: new Date().toISOString() })
      .eq("id", body.page_id);
    await recordEvent("ocr", "succeeded");
    await recordEvent("embedding", "succeeded", embedNote);
    await refreshDocumentSummary();

    return new Response(JSON.stringify({
      ok: true,
      page_id: body.page_id,
      chunks: rows.length,
      chunks_requested: chunks.length,
      embeds_missing: chunks.length - embeddedCount,
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

// ── helpers ──────────────────────────────────────────────────────────────────

function chunkText(text: string, size: number, overlap: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    // Break on newline if we can, to keep chunks readable
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
  // v1beta batch embed endpoint: batchEmbedContents
  const body = {
    requests: inputs.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      // Pin the output size so a future model swap/version bump on Google's
      // side can't silently change vector length and break the pgvector
      // column dimension check on `document_chunks.embedding`.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.embeddings ?? []).map((e: any) => (Array.isArray(e?.values) ? e.values : null));
}
