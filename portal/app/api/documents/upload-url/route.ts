import { auth } from "@clerk/nextjs/server";
import { after, NextRequest, NextResponse } from "next/server";

import { logEvent } from "@/lib/activity";
import { buildLocalDocumentInsert, LOCAL_DOCUMENT_BUCKET, LOCAL_DOCUMENT_MAX_BYTES } from "@/lib/documents/upload";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type UploadMeta = Record<string, unknown> & {
  pending_upload?: boolean;
  storage_path?: string;
};

async function tenantContext() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return null;
  const tenantId = await getOrCreateTenant(
    authTenantKey(userId, orgId),
    authTenantName(userId, orgSlug),
  );
  return { userId, tenantId };
}

function fireIngest(req: NextRequest, documentId: string): void {
  const url = new URL(`/api/documents/${documentId}/ingest`, req.url).toString();
  const cookie = req.headers.get("cookie") ?? "";
  after(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[documents/upload-url] ingest failed", {
        documentId,
        status: response.status,
        detail: detail.slice(0, 500),
      });
    }
  });
}

/** Reserve a document row and return a short-lived direct Supabase upload URL. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const context = await tenantContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { tenantId } = context;
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      file_name?: string;
      size?: number;
      content_type?: string;
    };
    if (!body.project_id || !body.file_name) {
      return NextResponse.json({ error: "project_id and file_name are required" }, { status: 400 });
    }
    if (typeof body.size !== "number" || body.size <= 0) {
      return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
    }
    if (body.size > LOCAL_DOCUMENT_MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds the 1GB upload limit." }, { status: 413 });
    }

    const db = await createServiceClient();
    const { data: project } = await db.from("projects")
      .select("id")
      .eq("id", body.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const documentId = crypto.randomUUID();
    const safeName = body.file_name.replace(/[^\w.\-]+/g, "_");
    const storagePath = `${tenantId}/${body.project_id}/${documentId}-${safeName}`;
    // Supabase's generated types do not yet expose this Storage method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: signed, error: signError } = await (db.storage.from(LOCAL_DOCUMENT_BUCKET) as any)
      .createSignedUploadUrl(storagePath);
    if (signError || !signed) {
      console.error("[documents/upload-url] signing failed", { message: signError?.message });
      return NextResponse.json({ error: `Could not create upload URL: ${signError?.message ?? "unknown error"}` }, { status: 502 });
    }

    const row = buildLocalDocumentInsert({
      documentId,
      tenantId,
      projectId: body.project_id,
      fileName: body.file_name,
      storagePath,
      fileSize: body.size,
      contentType: body.content_type || "application/octet-stream",
    });
    row.meta = { ...(row.meta as UploadMeta), pending_upload: true };
    const { error: insertError } = await db.from("documents").insert(row);
    if (insertError) {
      console.error("[documents/upload-url] reservation failed", { message: insertError.message });
      return NextResponse.json({ error: `Could not reserve document: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      document_id: documentId,
      upload: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        url: (signed as any).signedUrl ?? (signed as any).signedURL ?? (signed as any).url,
        method: "PUT" as const,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[documents/upload-url] create failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Confirm the direct upload and start ingestion after the response is sent. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const context = await tenantContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { tenantId, userId } = context;
    const { document_id } = await req.json().catch(() => ({})) as { document_id?: string };
    if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

    const db = await createServiceClient();
    const { data: doc } = await db.from("documents")
      .select("id, project_id, file_name, meta")
      .eq("id", document_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!doc.project_id) return NextResponse.json({ error: "Document is not attached to a project" }, { status: 409 });
    const meta = (doc.meta ?? {}) as UploadMeta;
    if (meta.pending_upload !== true || typeof meta.storage_path !== "string") {
      return NextResponse.json({ error: "Document upload is not pending" }, { status: 409 });
    }

    const slash = meta.storage_path.lastIndexOf("/");
    const folder = meta.storage_path.slice(0, slash);
    const name = meta.storage_path.slice(slash + 1);
    const { data: objects, error: listError } = await db.storage.from(LOCAL_DOCUMENT_BUCKET)
      .list(folder, { limit: 10, search: name });
    if (listError || !objects?.some((item) => item.name === name)) {
      return NextResponse.json({ error: "Uploaded file was not found in storage. Retry the upload." }, { status: 409 });
    }

    const nextMeta: UploadMeta = { ...meta, pending_upload: false };
    const { error: updateError } = await db.from("documents")
      .update({ status: "processing", meta: nextMeta as unknown as never })
      .eq("id", document_id)
      .eq("tenant_id", tenantId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    fireIngest(req, document_id);
    void logEvent({
      projectId: doc.project_id,
      tenantId,
      userId,
      entityType: "document",
      entityId: document_id,
      action: "uploaded",
      title: `Document uploaded: ${doc.file_name}`,
      meta: { storage: "supabase", storage_bucket: LOCAL_DOCUMENT_BUCKET },
    });
    return NextResponse.json({ document: { id: document_id, file_name: doc.file_name, status: "processing" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[documents/upload-url] finalize failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Remove an incomplete reservation and any partially uploaded object. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const context = await tenantContext();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { tenantId } = context;
    const { document_id } = await req.json().catch(() => ({})) as { document_id?: string };
    if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });
    const db = await createServiceClient();
    const { data: doc } = await db.from("documents")
      .select("id, meta")
      .eq("id", document_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: true });
    const meta = (doc.meta ?? {}) as UploadMeta;
    if (meta.pending_upload !== true) {
      return NextResponse.json({ error: "Completed documents cannot be canceled" }, { status: 409 });
    }
    if (typeof meta.storage_path === "string") {
      await db.storage.from(LOCAL_DOCUMENT_BUCKET).remove([meta.storage_path]);
    }
    const { error } = await db.from("documents").delete()
      .eq("id", document_id)
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[documents/upload-url] cancel failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
