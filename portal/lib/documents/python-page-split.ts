/**
 * Split a PDF that is too large for the edge pdf-lib isolate.
 * The Python service writes one page object at a time; this module records
 * document_pages and fans out the same workers the edge split uses.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { pythonApiBaseUrl, pythonApiHeaders } from "@/lib/python-api";
import { PLANS_BUCKET } from "@/lib/documents/storage";
import type { TablesInsert } from "@/lib/supabase/types";

export interface PythonSplitArgs {
  tenantId: string;
  projectId: string;
  documentId: string;
  userId: string;
  originalPath: string;
  sourceUrl?: string;
  downloadAuthorization?: string;
  uploadOriginalPath?: string;
}

interface SplitPage {
  page_number: number;
  storage_path: string;
}

export async function splitOversizedPdfOnPython(args: PythonSplitArgs): Promise<void> {
  const db = await createServiceClient();
  let sourceUrl = args.sourceUrl;
  if (!sourceUrl) {
    const { data: signed, error: signErr } = await db.storage.from(PLANS_BUCKET).createSignedUrl(args.originalPath, 60 * 60);
    if (signErr || !signed?.signedUrl) {
      throw new Error(`Could not sign download URL: ${signErr?.message ?? "unknown"}`);
    }
    sourceUrl = signed.signedUrl;
  }

  const res = await fetch(`${pythonApiBaseUrl()}/api/documents/split-pdf`, {
    method: "POST",
    headers: {
      ...pythonApiHeaders({ tenantId: args.tenantId, projectId: args.projectId }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_url: sourceUrl,
      document_id: args.documentId,
      bucket: PLANS_BUCKET,
      authorization: args.downloadAuthorization,
      upload_original_path: args.uploadOriginalPath,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch { /* keep */ }
    throw new Error(`Python page split failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const parsed = JSON.parse(text) as { pages?: SplitPage[] };
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  if (pages.length === 0) throw new Error("Python page split returned no pages");

  const pageRows: TablesInsert<"document_pages">[] = pages.map((page) => ({
    id: crypto.randomUUID(),
    tenant_id: args.tenantId,
    document_id: args.documentId,
    page_number: page.page_number,
    storage_path: page.storage_path,
    status: "pending",
    vectors: null,
    vector_status: "pending",
  }));

  const { error: delErr } = await db.from("document_pages").delete().eq("document_id", args.documentId).eq("tenant_id", args.tenantId);
  if (delErr) throw new Error(`clear document_pages: ${delErr.message}`);
  const { error: insErr } = await db.from("document_pages").insert(pageRows);
  if (insErr) throw new Error(`insert document_pages: ${insErr.message}`);

  const sheetRows: TablesInsert<"sheets">[] = pageRows.map((page) => ({
    tenant_id: args.tenantId,
    project_id: args.projectId,
    document_id: args.documentId,
    document_page_id: page.id,
    page_number: page.page_number,
    processing_status: "pending",
  }));
  const { error: sheetErr } = await db.from("sheets").insert(sheetRows);
  if (sheetErr) console.warn("[python-page-split] insert sheets failed:", sheetErr.message);

  const { data: docMetaRow } = await db.from("documents").select("meta").eq("id", args.documentId).eq("tenant_id", args.tenantId).maybeSingle();
  const prevMeta = docMetaRow?.meta && typeof docMetaRow.meta === "object" && !Array.isArray(docMetaRow.meta)
    ? docMetaRow.meta as Record<string, unknown>
    : {};
  await db.from("documents").update({
    status: "split",
    split_status: "done",
    page_count: pages.length,
    meta: {
      ...prevMeta,
      processing_summary: {
        pages_enqueued: pageRows.length,
        split_on: "python",
        updated_at: new Date().toISOString(),
      },
    },
    last_error: null,
    last_error_step: null,
  }).eq("id", args.documentId).eq("tenant_id", args.tenantId);

  await db.rpc("refresh_document_processing_summary", { p_document_id: args.documentId });
  await fanOutPageWorkers(pageRows, args);
}

async function fanOutPageWorkers(pageRows: TablesInsert<"document_pages">[], args: PythonSplitArgs): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn("[python-page-split] missing Supabase URL or service key; pages are stored and workers were not kicked");
    return;
  }
  const base = supabaseUrl.replace(/\/$/, "");
  const jobs = pageRows.flatMap((page) => [
    { url: `${base}/functions/v1/page-processor`, page },
    { url: `${base}/functions/v1/page-takeoff-worker`, page },
  ]);
  for (let i = 0; i < jobs.length; i += 20) {
    await Promise.allSettled(jobs.slice(i, i + 20).map((job) => fetch(job.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_id: job.page.id,
        document_id: args.documentId,
        tenant_id: args.tenantId,
        project_id: args.projectId,
        page_number: job.page.page_number,
        storage_path: job.page.storage_path,
        user_id: args.userId,
      }),
    })));
  }
}
