import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";
import { PLANS_UPLOAD_BUCKET } from "@/lib/documents/signed-upload";
import {
  enqueueRailwayExtractFromStorage,
  shouldEnqueueRailwayExtract,
} from "@/lib/documents/railwayExtract";
import { shouldMarkIngestStartError } from "@/lib/documents/ingest-start";

export const runtime = "nodejs";

/**
 * POST /api/documents/upload-url/complete
 * Body: { document_id }
 *
 * Called after the browser finishes a direct PUT/TUS to Supabase Storage.
 * Verifies the object exists, then:
 *  - PDF / raster → fire-and-forget ingest (large PDFs → page-split-worker)
 *  - DWG / DXF / IFC → Railway Celery extract-async via signed source_url
 *    (ezdxf never runs inside Vercel's execution timeout)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const body = await req.json().catch(() => ({})) as { document_id?: string };
    if (!body.document_id) {
      return NextResponse.json({ error: "document_id required" }, { status: 400 });
    }

    const db = await createServiceClient();
    const { data: doc, error } = await db
      .from("documents")
      .select("id, file_name, project_id, status, meta")
      .eq("id", body.document_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const storagePath = typeof meta.storage_path === "string" ? meta.storage_path : null;
    if (!storagePath) {
      return NextResponse.json({ error: "Document has no storage_path" }, { status: 409 });
    }

    // Confirm bytes landed in Storage before kicking processing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: listed, error: listErr } = await (db.storage.from(PLANS_UPLOAD_BUCKET) as any)
      .list(storagePath.includes("/") ? storagePath.slice(0, storagePath.lastIndexOf("/")) : "", {
        search: storagePath.includes("/") ? storagePath.slice(storagePath.lastIndexOf("/") + 1) : storagePath,
        limit: 5,
      });
    if (listErr) {
      return NextResponse.json({ error: `Could not verify upload: ${listErr.message}` }, { status: 502 });
    }
    const objectName = storagePath.includes("/") ? storagePath.slice(storagePath.lastIndexOf("/") + 1) : storagePath;
    const found = Array.isArray(listed) && listed.some((row: { name?: string }) => row?.name === objectName);
    if (!found) {
      return NextResponse.json({ error: "Upload not found in storage yet — retry complete in a moment" }, { status: 409 });
    }

    if (doc.project_id) {
      void logEvent({
        projectId: doc.project_id,
        tenantId,
        userId,
        entityType: "document",
        entityId: doc.id,
        action: "uploaded",
        title: `Document uploaded: ${doc.file_name}`,
        meta: { storage_path: storagePath, storage: PLANS_UPLOAD_BUCKET },
      });
    }

    // ── CAD / IFC → Railway Celery (Strategy 4) ────────────────────────────
    if (shouldEnqueueRailwayExtract(doc.file_name)) {
      try {
        const user = await currentUser();
        const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
        const job = await enqueueRailwayExtractFromStorage({
          db,
          storagePath,
          fileName: doc.file_name,
          tenantId,
          projectId: doc.project_id,
          email,
        });
        await db.from("documents").update({
          status: "processing",
          processing_started_at: new Date().toISOString(),
          last_error: null,
          last_error_step: null,
          meta: {
            ...meta,
            railway_job_id: job.job_id,
            railway_poll_url: job.poll_url ?? null,
            processing: "railway_celery",
          },
        }).eq("id", doc.id).eq("tenant_id", tenantId);

        return NextResponse.json({
          ok: true,
          document: { id: doc.id, file_name: doc.file_name, status: "processing" },
          processing: "railway_celery",
          railway_job_id: job.job_id,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await db.from("documents").update({
          status: "error",
          last_error: detail.slice(0, 2000),
          last_error_step: "railway_extract_enqueue",
        }).eq("id", doc.id).eq("tenant_id", tenantId);
        return NextResponse.json({ error: detail }, { status: 502 });
      }
    }

    // Ingest owns processing_started_at. Stamping it here makes the claim
    // look in-flight, and the 409 that follows was being stored as a failure.
    await db.from("documents").update({
      status: "processing",
      last_error: null,
      last_error_step: null,
    }).eq("id", doc.id).eq("tenant_id", tenantId);

    void fetch(new URL(`/api/documents/${doc.id}/ingest`, req.url).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({}),
    }).then(async (res) => {
      if (!shouldMarkIngestStartError(res.status)) return;
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      try {
        await db.from("documents").update({
          status: "error",
          last_error: `Ingest failed to start (${res.status}): ${detail}`.slice(0, 2000),
          last_error_step: "ingest_start",
        }).eq("id", doc.id).in("status", ["processing", "pending"]);
      } catch (markErr) {
        console.error("[upload-url/complete] failed to mark document error", markErr);
      }
    }).catch(async (err) => {
      console.error("[upload-url/complete] ingest fetch failed", err);
      try {
        await db.from("documents").update({
          status: "error",
          last_error: `Ingest request failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
          last_error_step: "ingest_start",
        }).eq("id", doc.id).in("status", ["processing", "pending"]);
      } catch (markErr) {
        console.error("[upload-url/complete] failed to mark document error", markErr);
      }
    });

    return NextResponse.json({
      ok: true,
      document: { id: doc.id, file_name: doc.file_name, status: "processing" },
      processing: "async_ingest",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[documents/upload-url/complete] ${msg}` }, { status: 500 });
  }
}
