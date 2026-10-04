// Supabase Edge Function: page-processor
// Deno runtime.
//
// Contract (from page-split-worker):
//   POST { page_id, document_id, tenant_id, page_number, storage_path }
//
// Confirms the page file is in storage and marks the page ready. Text is
// read in the portal. This function does not call a model and does not
// embed, so an invalid or missing API key cannot fail the page.

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

    await db.from("document_pages")
      .update({
        status: "done",
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.page_id)
      .eq("tenant_id", body.tenant_id);
    await recordEvent("ocr", "succeeded", "local text is read in the portal");
    await recordEvent("embedding", "skipped", "embeddings are not required to store the sheet");
    await refreshDocumentSummary();

    return new Response(JSON.stringify({
      ok: true,
      page_id: body.page_id,
      reader: "local",
      chunks: 0,
    }), { status: 200 });
  } catch (err: any) {
    console.error("[page-processor]", err);
    const message = String(err?.message ?? err);
    await recordEvent("ocr", "failed", message);
    await db.from("document_pages")
      .update({ status: "error", error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", body.page_id);
    await refreshDocumentSummary();
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
