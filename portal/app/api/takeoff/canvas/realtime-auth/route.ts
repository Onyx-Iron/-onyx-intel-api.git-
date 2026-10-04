import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
  assertPageBelongsToProject,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { canvasChannelName } from "@/lib/takeoff/canvas/canvas-realtime";
import { canMintRealtimeJwt, mintRealtimeJwt } from "@/lib/supabase/mint-realtime-jwt";

export const runtime = "nodejs";

/**
 * Preflight + optional JWT for private Realtime canvas channels.
 *
 * POST { project_id, page_id }
 * → membership-gated { topic, displayName, senderId, token?, privateChannel }
 *
 * When SUPABASE_JWT_SECRET is set, returns a short-lived JWT so the browser
 * can call realtime.setAuth + join with `private: true`. Without the secret,
 * the route still enforces Clerk membership before the UI opens a channel.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    project_id?: string;
    page_id?: string;
  };
  const projectId = body.project_id?.trim();
  const pageId = body.page_id?.trim();
  if (!projectId || !pageId) {
    return NextResponse.json({ error: "project_id and page_id required" }, { status: 400 });
  }

  const tenantKey = authTenantKey(userId, orgId);
  const tenantId = await getOrCreateTenant(tenantKey, authTenantName(userId, orgSlug));

  const denied = await requirePermission(tenantId, userId, "field", "read");
  if (denied) return denied;

  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
    await assertPageBelongsToProject(pageId, projectId, tenantId);
  } catch (err) {
    const mapped = ownershipDenied(err);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }

  const user = await currentUser();
  const displayName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.primaryEmailAddress?.emailAddress ||
    "Estimator";

  let token: string | null = null;
  let privateChannel = false;
  if (canMintRealtimeJwt()) {
    try {
      token = mintRealtimeJwt({
        sub: userId,
        orgId: tenantKey,
        expiresInSeconds: 60 * 60,
      });
      privateChannel = true;
    } catch {
      token = null;
      privateChannel = false;
    }
  }

  return NextResponse.json({
    ok: true,
    topic: canvasChannelName(projectId, pageId),
    displayName,
    senderId: userId,
    token,
    privateChannel,
  });
}
