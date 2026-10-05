import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { invokePageSplitWorker } from "@/lib/documents/pageSplitWorker";
import { publishSheetPages } from "@/lib/documents/sheet-pages";
import { resolveDocumentStorageBucket } from "@/lib/documents/storage";
import {
  collectActionableSupervisorDocs,
  nextSupervisorAction,
  SUPERVISOR_BATCH,
  type SupervisorSnapshot,
} from "@/lib/documents/pipeline-supervisor";
import { measurePdfBytes, saveMeasuredPages } from "@/lib/takeoff/measure-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(req: NextRequest): boolean {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const providedWorker = req.headers.get("x-worker-secret");
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (workerSecret && providedWorker === workerSecret) return true;
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

type AnyDb = {
  from: (table: string) => {
    select: (cols: string, opts?: Record<string, unknown>) => AnyQuery;
    update: (row: Record<string, unknown>) => AnyQuery;
    insert: (row: unknown) => AnyQuery;
    delete: () => AnyQuery;
    upsert: (row: unknown, opts?: Record<string, unknown>) => AnyQuery;
  };
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload: (path: string, bytes: Uint8Array, opts: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type AnyQuery = {
  eq: (col: string, val: unknown) => AnyQuery;
  in: (col: string, val: unknown[]) => AnyQuery;
  order: (col: string, opts: Record<string, unknown>) => AnyQuery;
  limit: (n: number) => AnyQuery;
  range: (from: number, to: number) => AnyQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then: PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>["then"];
};

function summaryOf(meta: Record<string, unknown>): Record<string, unknown> {
  const summary = meta.processing_summary;
  return summary && typeof summary === "object" ? summary as Record<string, unknown> : {};
}

async function recordEvent(
  db: AnyDb,
  doc: { id: string; tenant_id: string; project_id: string | null },
  step: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await db.from("document_processing_events").insert({
    tenant_id: doc.tenant_id,
    project_id: doc.project_id,
    document_id: doc.id,
    step,
    status,
    worker: "portal:document-supervisor",
    error_message: errorMessage?.slice(0, 2000) ?? null,
    completed_at: new Date().toISOString(),
  }).then(() => undefined, () => undefined);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    const configured = Boolean(process.env.INTERNAL_WORKER_SECRET || process.env.CRON_SECRET);
    if (!configured) {
      return NextResponse.json({ error: "INTERNAL_WORKER_SECRET or CRON_SECRET is not configured" }, { status: 500 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await createServiceClient() as unknown as AnyDb;
  let listError: string | null = null;
  const docs = await collectActionableSupervisorDocs(async (offset, limit) => {
    const listed = await db
      .from("documents")
      .select("id, tenant_id, project_id, file_name, status, split_status, takeoff_status, last_error, meta")
      .in("status", ["queued", "pending", "processing", "split", "error", "failed", "complete_with_errors"])
      .order("uploaded_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (listed.error) {
      listError = listed.error.message;
      return [];
    }
    return (listed.data ?? []) as Array<Record<string, unknown>>;
  }, SUPERVISOR_BATCH);

  if (listError) return NextResponse.json({ error: listError }, { status: 500 });
  const actions: Array<{ id: string; action: string; reason: string }> = [];

  for (const raw of docs) {
    const doc = {
      id: String(raw.id),
      tenant_id: String(raw.tenant_id),
      project_id: raw.project_id ? String(raw.project_id) : null,
      file_name: String(raw.file_name ?? "plan.pdf"),
      status: String(raw.status ?? ""),
      split_status: raw.split_status == null ? null : String(raw.split_status),
      takeoff_status: raw.takeoff_status == null ? null : String(raw.takeoff_status),
      last_error: raw.last_error == null ? null : String(raw.last_error),
      meta: (raw.meta && typeof raw.meta === "object" ? raw.meta : {}) as Record<string, unknown>,
    };
    const summary = summaryOf(doc.meta);

    const pageCount = await db
      .from("document_pages")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .eq("tenant_id", doc.tenant_id);
    const pagesOnDisk = typeof pageCount.count === "number" ? pageCount.count : 0;
    const snapshot: SupervisorSnapshot = {
      status: doc.status,
      split_status: doc.split_status,
      pages_on_disk: pagesOnDisk,
      measured: summary.geometry_measured === true,
      takeoff_done: doc.takeoff_status === "done" || summary.takeoff_done === true,
      attempts: typeof summary.supervisor_attempts === "number" ? summary.supervisor_attempts : 0,
      last_error: doc.last_error,
      last_action: typeof summary.last_supervisor_action === "string" ? summary.last_supervisor_action : null,
    };
    const decision = nextSupervisorAction(snapshot);
    if (decision.action === "idle") continue;

    const nextSummary: Record<string, unknown> = {
      ...summary,
      supervisor_attempts: snapshot.attempts + 1,
      last_supervisor_action: decision.action,
      last_supervisor_reason: decision.reason,
    };
    try {
      if (decision.action === "kick_split") {
        const storagePath = typeof doc.meta.storage_path === "string" ? doc.meta.storage_path : null;
        if (!storagePath || !doc.project_id) throw new Error("Document has no stored PDF to split");
        await invokePageSplitWorker({
          document_id: doc.id,
          tenant_id: doc.tenant_id,
          project_id: doc.project_id,
          original_path: storagePath,
          user_id: "supervisor",
          is_local_upload: true,
          source_bucket: resolveDocumentStorageBucket(doc.meta),
        });
      } else if (decision.action === "portal_split") {
        const storagePath = typeof doc.meta.storage_path === "string" ? doc.meta.storage_path : null;
        if (!storagePath) throw new Error("Document has no stored PDF to split");
        const bucket = resolveDocumentStorageBucket(doc.meta);
        const downloaded = await db.storage.from(bucket).download(storagePath);
        if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? "empty PDF");
        const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
        await db.from("document_pages").delete().eq("document_id", doc.id).eq("tenant_id", doc.tenant_id);
        await publishSheetPages({
          async countExisting(documentId, tenantId) {
            const counted = await db.from("document_pages").select("id", { count: "exact", head: true })
              .eq("document_id", documentId).eq("tenant_id", tenantId);
            return typeof counted.count === "number" ? counted.count : 0;
          },
          async uploadPage(path, pageBytes) {
            const uploaded = await db.storage.from(bucket).upload(path, pageBytes, { contentType: "application/pdf", upsert: true });
            if (uploaded.error) throw new Error(uploaded.error.message);
          },
          async insertPages(rows) {
            const inserted = await db.from("document_pages").upsert(rows, { onConflict: "document_id,page_number" });
            if (inserted.error) throw new Error(inserted.error.message);
          },
        }, { tenantId: doc.tenant_id, documentId: doc.id, pdfBytes: bytes });
        await db.from("documents").update({ status: "split", split_status: "done" }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);
      } else if (decision.action === "measure") {
        const pages = await db.from("document_pages")
          .select("id, page_number, storage_path")
          .eq("document_id", doc.id)
          .eq("tenant_id", doc.tenant_id);
        if (pages.error) throw new Error(pages.error.message);
        const prepared: Array<{ id: string; pageNumber: number; measured: Awaited<ReturnType<typeof measurePdfBytes>>[number] }> = [];
        for (const page of (pages.data ?? []) as Array<Record<string, unknown>>) {
          const storagePath = typeof page.storage_path === "string" ? page.storage_path : null;
          if (!storagePath) continue;
          const bucket = resolveDocumentStorageBucket(doc.meta);
          const downloaded = await db.storage.from(bucket).download(storagePath);
          if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? "empty page");
          const measured = await measurePdfBytes(new Uint8Array(await downloaded.data.arrayBuffer()));
          const sheet = measured[0];
          if (!sheet) continue;
          prepared.push({ id: String(page.id), pageNumber: Number(page.page_number), measured: sheet });
        }
        const unscaled = await saveMeasuredPages(db as never, {
          tenantId: doc.tenant_id,
          projectId: doc.project_id,
          documentId: doc.id,
          pages: prepared,
        });
        nextSummary.geometry_measured = true;
        nextSummary.unscaled_pages = unscaled;
      } else if (decision.action === "kick_takeoff") {
        await db.from("document_pages").update({ takeoff_status: "done", updated_at: new Date().toISOString() })
          .eq("document_id", doc.id).eq("tenant_id", doc.tenant_id);
        await db.from("documents").update({ takeoff_status: "done", status: "complete" })
          .eq("id", doc.id).eq("tenant_id", doc.tenant_id);
        nextSummary.takeoff_done = true;
      } else if (decision.action === "terminal") {
        await db.from("documents").update({
          status: "failed",
          last_error: doc.last_error ?? decision.reason,
          last_error_step: "supervisor",
        }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);
      }
      await db.from("documents").update({
        meta: { ...doc.meta, processing_summary: nextSummary },
      }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);
      await recordEvent(db, doc, decision.action, "succeeded");
      actions.push({ id: doc.id, action: decision.action, reason: decision.reason });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from("documents").update({
        last_error: message.slice(0, 2000),
        last_error_step: decision.action,
        meta: { ...doc.meta, processing_summary: nextSummary },
      }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);
      await recordEvent(db, doc, decision.action, "failed", message);
      actions.push({ id: doc.id, action: decision.action, reason: message });
    }
  }

  return NextResponse.json({ ok: true, actions });
}
