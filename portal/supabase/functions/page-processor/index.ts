// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Pipeline:
//   1. Download single-page PDF bytes from storage.
//   2. Read the sheet. OpenAI gpt-4.1 (Responses API, detail high) when
//      `openai_api_key` is on the body or OPENAI_API_KEY is set. Otherwise
//      Gemini generateContent with inline PDF bytes.
//   3. Chunk the extracted text (~1200 chars, 200-char overlap).
//   4. Embed each chunk at 768 dimensions (text-embedding-3-large, or
//      gemini-embedding-2 when only Gemini is configured).
//   5. Insert into `document_chunks` with page_id + page_number.
//   6. Update `document_pages.status="done"` and stash `ocr_text`.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   OPENAI_API_KEY (preferred; the portal also forwards it per request),
//   GEMINI_API_KEY (fallback),
//   PLANS_BUCKET (default "plans-bucket"),
//   GEMINI_TEXT_MODEL  (default "gemini-2.5-pro"),
//   GEMINI_EMBED_MODEL (default "gemini-embedding-2"; text-embedding-004 is ignored).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY     = Deno.env.get("GEMINI_API_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
const TEXT_MODEL         = Deno.env.get("GEMINI_TEXT_MODEL") ?? "gemini-2.5-pro";
const RETIRED_EMBED_MODELS = new Set(["text-embedding-004"]);
const configuredEmbed = Deno.env.get("GEMINI_EMBED_MODEL")?.trim();
const EMBED_MODEL = !configuredEmbed || RETIRED_EMBED_MODELS.has(configuredEmbed)
  ? "gemini-embedding-2"
  : configuredEmbed;

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
  page_number: number;
  storage_path: string;
  openai_api_key?: string;
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
  async function recordEvent(step: "ocr" | "embedding", status: "started" | "succeeded" | "failed" | "skipped", errorMessage?: string): Promise<void> {
    await db.from("document_processing_events").insert({
      tenant_id: body.tenant_id,
      project_id: null,
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

  // The documents UI and project chat read `pages` / `chunks`. The splitter
  // writes `document_pages` / `document_chunks`. Copy each finished sheet
  // into both so one pipeline feeds insights and search.
  async function mirrorSearchCopies(text: string, parts: string[], vectors: Array<number[] | null>): Promise<void> {
    const { error: pageErr } = await db.from("pages").upsert({
      document_id: body.document_id,
      tenant_id: body.tenant_id,
      page_number: body.page_number,
      extracted_text: text || null,
    }, { onConflict: "document_id,page_number" });
    if (pageErr) throw new Error(`mirror pages: ${pageErr.message}`);
    await db.from("chunks").delete()
      .eq("document_id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .eq("page_number", body.page_number);
    if (parts.length === 0) return;
    const { data: docRow, error: docErr } = await db.from("documents")
      .select("project_id")
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id)
      .maybeSingle();
    if (docErr) throw new Error(`mirror project: ${docErr.message}`);
    if (!docRow?.project_id) return;
    const mirrored = parts.map((content, i) => ({
      id: crypto.randomUUID(),
      tenant_id: body.tenant_id,
      document_id: body.document_id,
      project_id: docRow.project_id,
      page_number: body.page_number,
      content,
      embedding: vectors[i] ? `[${vectors[i]!.join(",")}]` : null,
    }));
    const { error: chunkErr } = await db.from("chunks").insert(mirrored);
    if (chunkErr) throw new Error(`mirror chunks: ${chunkErr.message}`);
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
    const openaiKey = body.openai_api_key?.trim() || Deno.env.get("OPENAI_API_KEY")?.trim() || "";
    const sheetPrompt = "Extract all readable text from this construction plan sheet. Preserve line breaks and tabular structure. Return raw text only.";

    // OpenAI reads the sheet at high detail. Gemini is only used when that key is absent.
    let text: string;
    if (openaiKey) {
      text = await extractPageWithOpenAI(openaiKey, b64, sheetPrompt);
    } else {
      const genBody = {
        contents: [{
          role: "user",
          parts: [
            { text: sheetPrompt },
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
      text = (genJson.candidates?.[0]?.content?.parts ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((p: any) => p?.thought !== true)
        .map((p: any) => p.text ?? "")
        .join("")
        .trim();
    }

    // ── 3. Chunk ────────────────────────────────────────────────────────────
    const chunks = chunkText(text, 1200, 200);
    if (chunks.length === 0) {
      await mirrorSearchCopies(text, [], []);
      await db.from("document_pages")
        .update({ status: "done", ocr_text: text || null, updated_at: new Date().toISOString() })
        .eq("id", body.page_id);
      await recordEvent("ocr", "succeeded");
      await recordEvent("embedding", "skipped", "no chunks extracted");
      await refreshDocumentSummary();
      return new Response(JSON.stringify({ ok: true, page_id: body.page_id, chunks: 0 }), { status: 200 });
    }

    // ── 4. Embed (batched — gemini-embedding-2 supports batch mode) ─────────
    await recordEvent("embedding", "started");
    const embeddings = openaiKey ? await embedBatchOpenAI(openaiKey, chunks) : await embedBatch(chunks);

    // ── 5. Insert chunks, replacing any earlier attempt for this page ────────
    await db.from("document_chunks").delete().eq("page_id", body.page_id).eq("tenant_id", body.tenant_id);
    const rows = chunks.map((content, i) => ({
      id: crypto.randomUUID(),
      tenant_id: body.tenant_id,
      document_id: body.document_id,
      page_id: body.page_id,
      page_number: body.page_number,
      chunk_index: i,
      content,
      embedding: embeddings[i] ?? null,
    }));
    const { error: insErr } = await db.from("document_chunks").insert(rows);
    if (insErr) throw new Error(`insert chunks: ${insErr.message}`);
    await mirrorSearchCopies(text, chunks, embeddings);

    // ── 6. Done ─────────────────────────────────────────────────────────────
    await db.from("document_pages")
      .update({ status: "done", ocr_text: text, updated_at: new Date().toISOString() })
      .eq("id", body.page_id);
    await recordEvent("ocr", "succeeded");
    await recordEvent("embedding", "succeeded");
    await refreshDocumentSummary();

    return new Response(JSON.stringify({ ok: true, page_id: body.page_id, chunks: rows.length }), { status: 200 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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

async function extractPageWithOpenAI(apiKey: string, b64: string, prompt: string): Promise<string> {
  const res = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4.1",
      input: [{
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "sheet.pdf",
            file_data: `data:application/pdf;base64,${b64}`,
            detail: "high",
          },
          { type: "input_text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const errText = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`openai read ${res.status}: ${errText}`);
  }
  const json = await res.json();
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  return (json.output ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .flatMap((item: any) => item.content ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((part: any) => part.text ?? "")
    .join("")
    .trim();
}

async function embedBatchOpenAI(apiKey: string, inputs: string[]): Promise<number[][]> {
  const res = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "text-embedding-3-large",
      input: inputs,
      dimensions: 768,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`openai embed ${res.status}: ${detail}`);
  }
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = [...(json.data ?? [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== inputs.length || rows.some((row) => !Array.isArray(row.embedding) || row.embedding.length !== 768)) {
    throw new Error("OpenAI embeddings did not return 768-dimension vectors");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => row.embedding as number[]);
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
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`embed batchEmbedContents ${res.status}: ${detail}`);
  }
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vectors = (json.embeddings ?? []).map((e: any) => (Array.isArray(e?.values) ? e.values as number[] : null));
  if (vectors.length !== inputs.length || vectors.some((values: number[] | null) => !values || values.length !== 768)) {
    throw new Error(`Embedding model ${EMBED_MODEL} did not return 768-dimension vectors`);
  }
  return vectors;
}
