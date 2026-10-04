import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { pythonApiBaseUrl, pythonApiHeaders } from "@/lib/python-api";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

const PYTHON_API_URL = pythonApiBaseUrl();

export const runtime = "nodejs";
export const maxDuration = 300; // CAD/IFC parsing + AI vision can both take time

/**
 * Unified takeoff extraction entry point.
 *
 * Modes (selected via query string):
 *   - default:            multipart upload → Python /api/takeoff/extract (deterministic, JSON response)
 *   - ?stream=true:       multipart upload → Python /api/stream/upload    (NDJSON streaming response)
 *   - ?ai_fallback=true:  drawing pages are measured from vectors; this path returns no rows
 *
 * Tenant isolation is enforced on every path: X-Onyx-Tenant uses the Clerk
 * org id (or `user_<userId>` for personal workspaces).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantKey  = orgId ?? `user_${userId}`;
    const projectId  = req.nextUrl.searchParams.get("project_id") ?? "";
    const aiFallback = req.nextUrl.searchParams.get("ai_fallback") === "true";
    const streaming  = req.nextUrl.searchParams.get("stream") === "true";

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    if (projectId) {
      try {
        await assertProjectBelongsToTenant(projectId, tenantId);
      } catch (err) {
        const owned = ownershipDenied(err);
        if (owned) return owned;
        throw err;
      }
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    if (aiFallback) {
      return await runAiFallback(req, tenantKey, email);
    }

    if (streaming) {
      return await runStreamingExtract(req, tenantKey, projectId, email);
    }

    return await runDeterministicExtract(req, tenantKey, projectId, email);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[takeoff/extract] ${msg}` }, { status: 500 });
  }
}

// ── Default: deterministic single-shot extract ───────────────────────────────
async function runDeterministicExtract(req: NextRequest, tenantKey: string, projectId: string, email: string | null): Promise<NextResponse> {
  const formData = await req.formData();

  const upstream = await fetch(`${PYTHON_API_URL}/api/takeoff/extract`, {
    method: "POST",
    headers: pythonApiHeaders({ email, tenantId: tenantKey, projectId }),
    body: formData,
    // @ts-expect-error — Node fetch supports duplex for streaming bodies
    duplex: "half",
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    let detail = text;
    try { detail = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* keep raw */ }
    return NextResponse.json({ error: detail }, { status: upstream.status });
  }

  return NextResponse.json(JSON.parse(text));
}

// ── Streaming: NDJSON passthrough for large JSON takeoff uploads ─────────────
async function runStreamingExtract(req: NextRequest, tenantKey: string, projectId: string, email: string | null): Promise<Response> {
  const formData = await req.formData();

  const upstreamUrl = new URL(`${PYTHON_API_URL}/api/stream/upload`);
  const chunkSize = req.nextUrl.searchParams.get("chunk_size");
  if (chunkSize) upstreamUrl.searchParams.set("chunk_size", chunkSize);

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: "POST",
    headers: pythonApiHeaders({ email, tenantId: tenantKey, projectId }),
    body: formData,
    // @ts-expect-error — Node 18 fetch supports duplex for streaming
    duplex: "half",
  });

  if (!upstreamRes.ok) {
    const detail = await upstreamRes.text().catch(() => "upstream error");
    return NextResponse.json(
      { error: `[takeoff/extract stream] upstream ${upstreamRes.status}: ${detail}` },
      { status: 502 },
    );
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type":      "application/x-ndjson",
      "Cache-Control":     "no-cache, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runAiFallback(_req: NextRequest, _tenantKey: string, _email: string | null): Promise<NextResponse> {
  return NextResponse.json({
    rows: [],
    notice: "Drawing pages are measured from vectors after the scale is confirmed.",
  });
}
