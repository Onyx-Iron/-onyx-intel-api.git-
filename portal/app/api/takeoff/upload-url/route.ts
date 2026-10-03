import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";

// Aligned with the Supabase Edge Functions (`page-split-worker`, `page-processor`)
// which read/write everything under `plans-bucket/`. Keeping a single bucket
// name avoids silent cross-bucket drift where uploads land in one place and
// downstream workers look for them in another.
const BUCKET = "plans-bucket";

/**
 * POST /api/takeoff/upload-url
 *
 * Body: { project_id, file_name, size, content_type }
 *
 * Returns a Supabase Storage signed upload URL so the browser can PUT the
 * file bytes DIRECTLY to storage. Plan sets belong here (plans-bucket, 1 GB).
 * Function bodies now accept up to 100 MB, so medium CAD and spreadsheet
 * files can POST to /api/takeoff/extract instead.
 *
 * Flow:
 *   1. Client POSTs metadata (small JSON, well under body limit).
 *   2. Server auths via Clerk, resolves tenant, inserts a `documents` row
 *      in status="pending" with the reserved storage_path.
 *   3. Server creates a signed upload URL (5 min TTL) and returns it +
 *      document_id.
 *   4. Client PUTs bytes to the URL from the browser (no size limit from
 *      Vercel — the request never touches Vercel).
 *   5. Client calls `POST /api/takeoff/from-document` with document_id
 *      to run the takeoff.
 *
 * TakeoffTab sends plan-set PDFs and files over the function body limit
 * through here, and posts smaller CAD, IFC, and spreadsheet files directly
 * to `/api/takeoff/extract`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      file_name?: string;
      size?: number;
      content_type?: string;
    };
    const project_id = body.project_id;
    const file_name  = body.file_name;
    const content_type = body.content_type || "application/octet-stream";
    if (!project_id || !file_name) {
      return NextResponse.json({ error: "project_id and file_name are required" }, { status: 400 });
    }
    // Matches plans-bucket's file_size_limit (raised to 1GB after the
    // Supabase Pro upgrade — was 200MB, capped to fit under the Free tier's
    // 50MB global Storage ceiling that this route was originally built to
    // route around).
    if (typeof body.size === "number" && body.size > 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds the 1GB limit. Split the drawing set and retry." }, { status: 413 });
    }

    const db = await createServiceClient();

    // Verify project belongs to this tenant.
    const { data: project, error: projErr } = await db
      .from("projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).single();
    if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Same `originals/{document_id}.pdf` convention page-split-worker already
    // uses for Drive imports, so both paths are truly unified — the worker
    // doesn't need to know or care which route created the document.
    const documentId = crypto.randomUUID();
    const storagePath = `originals/${documentId}.pdf`;

    // Create the signed upload URL. Supabase returns a short-lived token that the
    // browser can PUT to directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: signed, error: signErr } = await (db.storage.from(BUCKET) as any)
      .createSignedUploadUrl(storagePath);
    if (signErr || !signed) {
      return NextResponse.json(
        { error: `Could not create upload URL: ${signErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }

    // Pre-insert the document row so `from-document` can find it after the client uploads.
    const insertRow: TablesInsert<"documents"> = {
      id: documentId,
      tenant_id: tenantId,
      project_id,
      file_name,
      status: "queued",
      uploaded_at: new Date().toISOString(),
      meta: buildDocumentRevisionMeta(file_name, {
        source: "local_upload",
        storage: "supabase",
        storage_path: storagePath,
        size: body.size ?? null,
        content_type,
      }),
    };
    const { data: doc, error: insertErr } = await db
      .from("documents").insert(insertRow).select("id").single();
    if (insertErr || !doc) {
      return NextResponse.json({ error: `[insert] ${insertErr?.message}` }, { status: 500 });
    }

    return NextResponse.json({
      document_id: doc.id,
      upload: {
        // Different Supabase client versions expose these keys; return all so the
        // client can pick whichever is present.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        url:   (signed as any).signedUrl ?? (signed as any).signedURL ?? (signed as any).url,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token: (signed as any).token,
        path:  storagePath,
        method: "PUT" as const,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[takeoff/upload-url] ${msg}` }, { status: 500 });
  }
}
