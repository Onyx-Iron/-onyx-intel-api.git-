// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Pipeline:
//   1. Download the single-page PDF from storage.
//   2. Read the embedded text layer with pdf.js.
//   3. Store that text on document_pages.ocr_text.
//   4. Replace document_chunks for this page. The embedding stays null.
//
// This function does not call a model, so a missing API key cannot fail
// the page. A missing file or a pdf.js failure marks the page error so
// the portal retry can run this worker again.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";

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
    const dl = await db.storage.from(PLANS_BUCKET).download(body.storage_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const text = await readSinglePageText(bytes);
    const chunks = chunkText(text, 1200, 200);

    const { error: clearErr } = await db.from("document_chunks")
      .delete()
      .eq("page_id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    if (clearErr) throw new Error(`clear chunks: ${clearErr.message}`);

    if (chunks.length > 0) {
      const rows = chunks.map((content, i) => ({
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        document_id: body.document_id,
        page_id: body.page_id,
        page_number: body.page_number,
        chunk_index: i,
        content,
        embedding: null,
      }));
      const { error: insErr } = await db.from("document_chunks").insert(rows);
      if (insErr) throw new Error(`insert chunks: ${insErr.message}`);
    }

    await db.from("document_pages")
      .update({
        status: "done",
        error: null,
        ocr_text: text || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    await recordEvent("ocr", "succeeded");
    await recordEvent(
      "embedding",
      "skipped",
      chunks.length === 0 ? "no text on this page" : "text stored without an embedding",
    );
    await refreshDocumentSummary();

    return new Response(JSON.stringify({
      ok: true,
      page_id: body.page_id,
      reader: "pdfjs",
      chunks: chunks.length,
    }), { status: 200 });
  } catch (err: any) {
    console.error("[page-processor]", err);
    const message = String(err?.message ?? err);
    await recordEvent("ocr", "failed", message);
    await db.from("document_pages")
      .update({ status: "error", error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    await refreshDocumentSummary();
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

async function readSinglePageText(pageBytes: Uint8Array): Promise<string> {
  const pdfjs = await import("https://esm.sh/pdfjs-dist@5.4.624/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: pageBytes,
    disableWorker: true,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return (content.items ?? [])
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    if (typeof doc.destroy === "function") await doc.destroy();
  }
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
