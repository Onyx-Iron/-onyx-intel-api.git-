import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/documents/:id/events — processing timeline for a document
 * (split / OCR / takeoff / embedding events from Edge + portal writers).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "read");
    if (denied) return denied;

    const db = await createServiceClient();
    const { data: doc, error: docErr } = await db
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "80");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 80;

    const { data: events, error } = await db
      .from("document_processing_events")
      .select(
        "id, step, status, worker, attempt_number, error_code, error_message, document_page_id, started_at, completed_at",
      )
      .eq("tenant_id", tenantId)
      .eq("document_id", documentId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Attach page_number when the event is page-scoped.
    const pageIds = Array.from(
      new Set(
        (events ?? [])
          .map((e) => e.document_page_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    const pageNumberById = new Map<string, number>();
    if (pageIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pages } = await (db as any)
        .from("document_pages")
        .select("id, page_number")
        .eq("tenant_id", tenantId)
        .in("id", pageIds);
      for (const p of (pages ?? []) as Array<{ id: string; page_number: number }>) {
        pageNumberById.set(p.id, p.page_number);
      }
    }

    return NextResponse.json({
      events: (events ?? []).map((e) => ({
        ...e,
        page_number: e.document_page_id ? pageNumberById.get(e.document_page_id) ?? null : null,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/events] ${msg}` }, { status: 502 });
  }
}
