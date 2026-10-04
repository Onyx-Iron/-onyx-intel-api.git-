import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getStorageProvider, isStorageProviderId } from "@/lib/storage/providers";
import { getTenantConnectionAccessToken } from "@/lib/connections/store";
import { getAccessToken } from "@/lib/google/oauth";
import { importPlanBytes } from "@/lib/documents/importBytes";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { captureException } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET ?provider=dropbox|sharefile&path= — list folder for cloud picker UI.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const providerId = req.nextUrl.searchParams.get("provider") ?? "dropbox";
    if (providerId !== "dropbox" && providerId !== "sharefile" && providerId !== "google_drive") {
      return NextResponse.json({ error: "provider must be dropbox|sharefile|google_drive" }, { status: 400 });
    }
    const path = req.nextUrl.searchParams.get("path") ?? "";

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    let token: string | null = null;
    let status = "disconnected";
    let detail: string | null | undefined;
    if (providerId === "google_drive") {
      token = await getAccessToken(tenantId, userId);
      status = token ? "connected" : "disconnected";
    } else {
      const t = await getTenantConnectionAccessToken(tenantId, userId, providerId);
      token = t.token;
      status = t.status;
      detail = t.detail;
    }
    if (!token) {
      return NextResponse.json({
        connected: false,
        files: [],
        hint: status === "error"
          ? (detail ?? "Token refresh failed — reconnect in Settings → Connections")
          : `Connect ${providerId} under Settings → Connections.`,
      });
    }

    const provider = getStorageProvider(providerId);
    if (!provider.listFolder) {
      return NextResponse.json({ files: [], hint: "Listing not supported for this provider" });
    }
    const files = await provider.listFolder(token, path || (providerId === "dropbox" ? "" : "root"));
    return NextResponse.json({
      connected: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mimeType,
        size: f.size,
        path: f.path ?? null,
      })),
    });
  } catch (err: unknown) {
    captureException(err, { route: "GET /api/documents/import-cloud" });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST { provider: dropbox|sharefile|google_drive, project_id, file_id, name?, mime? }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      provider?: string;
      project_id?: string;
      file_id?: string;
      name?: string;
      mime?: string;
      path?: string;
    };

    if (!body.provider || !isStorageProviderId(body.provider)) {
      return NextResponse.json({ error: "provider must be google_drive|dropbox|sharefile" }, { status: 400 });
    }
    if (body.provider === "local_upload" || body.provider === "gmail") {
      return NextResponse.json({ error: "Use upload or gmail import endpoints for this source" }, { status: 400 });
    }
    if (!body.project_id || !body.file_id) {
      return NextResponse.json({ error: "project_id and file_id required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try { await assertProjectBelongsToTenant(body.project_id, tenantId); }
    catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    let token: string | null = null;
    if (body.provider === "google_drive") {
      token = await getAccessToken(tenantId, userId);
    } else {
      const t = await getTenantConnectionAccessToken(
        tenantId,
        userId,
        body.provider as "dropbox" | "sharefile",
      );
      token = t.token;
      if (!token && t.status === "error") {
        return NextResponse.json({
          error: t.detail ?? "Connection error — reconnect in Settings → Connections",
          code: "CONNECTION_ERROR",
        }, { status: 412 });
      }
    }
    if (!token) {
      return NextResponse.json({
        error: `${body.provider} is not connected`,
        code: "NEED_CONNECTION",
      }, { status: 412 });
    }

    const provider = getStorageProvider(body.provider);
    if (!provider.downloadToBuffer) {
      return NextResponse.json({ error: "Provider cannot download" }, { status: 400 });
    }
    const pathOrId = body.path || body.file_id;
    const file = await provider.downloadToBuffer(token, pathOrId);
    const result = await importPlanBytes({
      tenantId,
      userId,
      projectId: body.project_id,
      fileName: body.name || file.name,
      mimeType: body.mime || file.mimeType,
      bytes: file.bytes,
      source: body.provider === "dropbox" ? "dropbox" : body.provider === "sharefile" ? "sharefile" : "cloud",
      sourceMeta: {
        cloud_provider: body.provider,
        cloud_file_id: body.file_id,
        cloud_path: body.path ?? null,
      },
      origin: req.nextUrl.origin,
      cookie: req.headers.get("cookie"),
    });

    return NextResponse.json({
      document_id: result.documentId,
      status: result.status,
      async_split: result.asyncSplit,
    }, { status: 202 });
  } catch (err: unknown) {
    captureException(err, { route: "POST /api/documents/import-cloud" });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
