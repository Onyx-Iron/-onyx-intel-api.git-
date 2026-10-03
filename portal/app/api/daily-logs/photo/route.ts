import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "daily-log-photos";

/**
 * Uploads a daily-log photo to the private storage bucket under a
 * tenant/project path. Returns the storage path + a short-lived signed URL.
 * Photos are never public — signed URLs are regenerated on read.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (file.type && !allowed.includes(file.type)) {
      return NextResponse.json({ error: "Only image files (JPEG/PNG/WebP/HEIC) are accepted" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Image exceeds 25 MB" }, { status: 413 });
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const rand = crypto.randomUUID();
    const path = `${tenantId}/${projectId}/${rand}.${ext}`;

    const db = await createServiceClient();
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (upErr) return NextResponse.json({ error: `[upload] ${upErr.message}` }, { status: 502 });

    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    return NextResponse.json({ path, url: signed?.signedUrl ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/daily-logs/photo] ${msg}` }, { status: 500 });
  }
}
