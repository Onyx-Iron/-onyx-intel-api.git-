// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Confirms the page file is in storage, stores embedded PDF text for Q&A,
// and marks the page ready. This function does not call a model and does not
// embed, so an invalid or missing API key cannot fail the page.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { textFromPdfTextItems } from "../../../lib/documents/page-text.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";
const MAX_STORED_PAGE_TEXT = 100_000;

/**
 * pdfjs is imported here, not at module load, so a failed text read cannot
 * stop the function from marking a stored page ready.
 */
async function embeddedPageText(bytes: Uint8Array): Promise<string | null> {
  try {
    const pdfjs = await import("https://esm.sh/pdfjs-dist@5.4.624/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false }).promise;
    try {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      const text = textFromPdfTextItems(content.items ?? []);
      return text ? text.slice(0, MAX_STORED_PAGE_TEXT) : null;
    } finally {
      if (typeof doc.destroy === "function") await doc.destroy();
    }
  } catch (err) {
    console.warn("[page-processor] embedded text extract failed", err);
    return null;
  }
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
    const dl = await db.storage.from(PLANS_BUCKET).download(body.storage_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? "empty"}`);
    const text = await embeddedPageText(new Uint8Array(await dl.data.arrayBuffer()));

    const pageUpdate: Record<string, unknown> = {
      status: "done",
      error: null,
      updated_at: new Date().toISOString(),
    };
    if (text) pageUpdate.ocr_text = text;
    const { error: pageErr } = await db.from("document_pages")
      .update(pageUpdate)
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    if (pageErr) throw new Error(`update page: ${pageErr.message}`);
    await recordEvent(
      "ocr",
      text ? "succeeded" : "skipped",
      text ? "embedded page text stored" : "no embedded text on this page",
    );
    await recordEvent("embedding", "skipped", "embeddings are not required to store the sheet");
    await refreshDocumentSummary();

    return new Response(JSON.stringify({
      ok: true,
      page_id: body.page_id,
      reader: "local",
      chars: text?.length ?? 0,
      chunks: 0,
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
