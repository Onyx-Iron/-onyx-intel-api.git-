import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const BUCKET = "plans-bucket";
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/**
 * GET ?project_id= — lists high-resolution progress images already stored
 * under this project's plans-bucket prefix, with short-lived signed URLs, so
 * the Project-to-Ad wrapper can let an estimator pick from real project
 * photos instead of uploading new ones.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  const prefix = `${tenantId}/${projectId}`;
  const { data: entries, error } = await db.storage.from(BUCKET).list(prefix, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const images = (entries ?? []).filter((e) => IMAGE_RE.test(e.name));
  const withUrls = await Promise.all(images.map(async (img) => {
    const path = `${prefix}/${img.name}`;
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    return { name: img.name, path, url: signed?.signedUrl ?? null };
  }));

  return NextResponse.json({ images: withUrls.filter((i) => i.url) });
}
