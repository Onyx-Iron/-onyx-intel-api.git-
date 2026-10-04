import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { reclaimStuckProcessingDocuments, reclaimStuckProcessingPages } from "@/lib/documents/reclaimStuck";
import { finalizeDocumentsFromOcr } from "@/lib/documents/finalizeDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 2000;
const MAX_STREAM_MS = 5 * 60 * 1000;

type DocSnapshot = {
  id: string;
  status: string | null;
  split_status: string | null;
  ocr_status: string | null;
  vector_status: string | null;
  takeoff_status: string | null;
  page_count: number | null;
  last_error: string | null;
  last_error_step: string | null;
  file_name: string | null;
  doc_type: string | null;
  uploaded_at: string | null;
  processed_at: string | null;
  meta: Record<string, unknown> | null;
};

function fingerprint(docs: DocSnapshot[]): string {
  return docs
    .map((d) => [
      d.id,
      d.status,
      d.split_status,
      d.ocr_status,
      d.vector_status,
      d.takeoff_status,
      d.page_count,
      d.last_error,
      d.last_error_step,
    ].join(":"))
    .join("|");
}

/**
 * SSE stream of document status for a project. Pushes when status columns
 * change so DocumentsTab can stop hammering the list endpoint every 4s.
 * Still runs reclaim/finalize on each tick (same side effects as GET /api/documents).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return new Response(JSON.stringify({ error: "project_id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  const startedAt = Date.now();
  let lastFp = "";
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          send("timeout", { ok: true });
          closed = true;
          controller.close();
          return;
        }
        try {
          await reclaimStuckProcessingDocuments(db, tenantId).catch(() => undefined);
          await reclaimStuckProcessingPages(db, tenantId).catch(() => undefined);
          await finalizeDocumentsFromOcr(db, tenantId).catch(() => undefined);

          const { data, error } = await db
            .from("documents")
            .select(
              "id,file_name,status,split_status,ocr_status,vector_status,takeoff_status,page_count,last_error,last_error_step,doc_type,uploaded_at,processed_at,meta",
            )
            .eq("tenant_id", tenantId)
            .eq("project_id", projectId)
            .order("uploaded_at", { ascending: false })
            .limit(200);

          if (error) {
            send("error", { error: error.message });
            return;
          }

          const docs = (data ?? []) as DocSnapshot[];
          const fp = fingerprint(docs);
          if (fp !== lastFp) {
            lastFp = fp;
            send("documents", { documents: docs });
          } else {
            send("ping", { t: Date.now() });
          }
        } catch (err) {
          send("error", { error: err instanceof Error ? err.message : String(err) });
        }
      };

      void tick();
      const interval = setInterval(() => { void tick(); }, TICK_MS);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
