import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { loadProjectKnowledgeSnapshot } from "@/lib/projects/knowledge";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsedId = uuidSchema.safeParse((await params).id);
    if (!parsedId.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const snapshot = await loadProjectKnowledgeSnapshot(tenantId, parsedId.data);
    if (!snapshot) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const response = NextResponse.json({ snapshot });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `[GET /api/projects/:id/knowledge] ${message}` }, { status: 500 });
  }
}
