import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import {
  assertUploadSize,
  buildOriginalStoragePath,
  parseSignedUploadPayload,
  PLANS_UPLOAD_BUCKET,
  TUS_THRESHOLD_BYTES,
} from "@/lib/documents/signed-upload";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";
import { isSha256Hex, reuseUpload } from "@/lib/documents/upload-identity";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";

/**
 * POST /api/documents/upload-url
 *
 * Body: { project_id, file_name, size?, content_type? }
 *
 * Returns a short-lived Supabase Storage signed upload URL so the browser
 * can PUT (or TUS) the multi‑MB/GB file DIRECTLY to plans-bucket — never
 * through Vercel's ~4.5 MB Serverless body limit.
 *
 * After the client finishes the binary transfer, call
 * POST /api/documents/upload-url/complete with { document_id } to fire ingest
 * (which offloads large PDFs to page-split-worker / Railway-side processing).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      file_name?: string;
      size?: number;
      content_type?: string;
      content_sha256?: string;
    };
    const project_id = body.project_id;
    const file_name = body.file_name;
    const content_type = body.content_type || "application/octet-stream";
    if (!project_id || !file_name) {
      return NextResponse.json({ error: "project_id and file_name are required" }, { status: 400 });
    }

    const sizeErr = assertUploadSize(body.size);
    if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 413 });

    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const db = await createServiceClient();
    const checksum = isSha256Hex(body.content_sha256) ? body.content_sha256.toLowerCase() : null;
    if (checksum) {
      const { data: existing } = await db
        .from("documents")
        .select("id, status, meta")
        .eq("tenant_id", tenantId)
        .eq("project_id", project_id)
        .eq("checksum", checksum)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const decision = existing ? reuseUpload(existing.status) : "new";
      if (existing && decision === "skip_upload") {
        return NextResponse.json({
          document_id: existing.id,
          reused: true,
          skip_upload: true,
          path: (existing.meta as { storage_path?: string } | null)?.storage_path ?? null,
        });
      }
      if (existing && decision === "replace_bytes") {
        const meta = (existing.meta && typeof existing.meta === "object")
          ? existing.meta as Record<string, unknown>
          : {};
        const storagePath = typeof meta.storage_path === "string"
          ? meta.storage_path
          : buildOriginalStoragePath(existing.id, file_name);
        // Keep the stored PDF and the current status until upload-url/complete
        // verifies the new bytes. Deleting the object and flipping the row to
        // pending first means a dropped PUT is followed by skip_upload, which
        // reports success while the plan file is gone.
        if (typeof meta.storage_path !== "string") {
          const { error: pathErr } = await db.from("documents").update({
            checksum,
            meta: { ...meta, storage_path: storagePath, size: body.size ?? null, content_type },
          }).eq("id", existing.id).eq("tenant_id", tenantId);
          if (pathErr) return NextResponse.json({ error: pathErr.message }, { status: 500 });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: signed, error: signErr } = await (db.storage.from(PLANS_UPLOAD_BUCKET) as any)
          .createSignedUploadUrl(storagePath, { upsert: true });
        if (signErr || !signed) {
          return NextResponse.json(
            { error: `Could not create upload URL: ${signErr?.message ?? "unknown"}` },
            { status: 500 },
          );
        }
        const parsed = parseSignedUploadPayload(signed as Record<string, unknown>);
        const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
        return NextResponse.json({
          document_id: existing.id,
          reused: true,
          skip_upload: false,
          upsert: true,
          path: storagePath,
          bucket: PLANS_UPLOAD_BUCKET,
          prefer_tus: typeof body.size === "number" && body.size >= TUS_THRESHOLD_BYTES,
          upload: { url: parsed.url, token: parsed.token, path: storagePath, method: "PUT" as const },
          tus: supabaseUrl && (parsed.token || anonKey)
            ? {
                endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
                headers: {
                  authorization: `Bearer ${parsed.token || anonKey}`,
                  apikey: anonKey,
                  "x-upsert": "true",
                },
                metadata: {
                  bucketName: PLANS_UPLOAD_BUCKET,
                  objectName: storagePath,
                  contentType: content_type,
                  cacheControl: "3600",
                },
                chunkSize: 6 * 1024 * 1024,
              }
            : null,
        });
      }
    }

    const documentId = crypto.randomUUID();
    const storagePath = buildOriginalStoragePath(documentId, file_name);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: signed, error: signErr } = await (db.storage.from(PLANS_UPLOAD_BUCKET) as any)
      .createSignedUploadUrl(storagePath);
    if (signErr || !signed) {
      return NextResponse.json(
        { error: `Could not create upload URL: ${signErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }

    const parsed = parseSignedUploadPayload(signed as Record<string, unknown>);
    if (!parsed.url) {
      return NextResponse.json({ error: "Storage did not return a signed upload URL" }, { status: 500 });
    }

    const insertRow: TablesInsert<"documents"> = {
      id: documentId,
      tenant_id: tenantId,
      project_id,
      file_name,
      status: "pending",
      uploaded_at: new Date().toISOString(),
      checksum,
      meta: buildDocumentRevisionMeta(file_name, {
        source: "local_upload",
        storage: PLANS_UPLOAD_BUCKET,
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

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "documents",
      record_id: doc.id,
      new_values: insertRow as unknown as Record<string, unknown>,
    });

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
    const preferTus = typeof body.size === "number" && body.size >= TUS_THRESHOLD_BYTES;

    return NextResponse.json({
      document_id: doc.id,
      path: storagePath,
      bucket: PLANS_UPLOAD_BUCKET,
      prefer_tus: preferTus,
      upload: {
        url: parsed.url,
        token: parsed.token,
        path: storagePath,
        method: "PUT" as const,
      },
      tus: supabaseUrl && (parsed.token || anonKey)
        ? {
            endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
            headers: {
              // Signed upload token authorizes this object; anon key is required by Storage API.
              authorization: `Bearer ${parsed.token || anonKey}`,
              apikey: anonKey,
              "x-upsert": "false",
            },
            metadata: {
              bucketName: PLANS_UPLOAD_BUCKET,
              objectName: storagePath,
              contentType: content_type,
              cacheControl: "3600",
            },
            chunkSize: 6 * 1024 * 1024,
          }
        : null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[documents/upload-url] ${msg}` }, { status: 500 });
  }
}
