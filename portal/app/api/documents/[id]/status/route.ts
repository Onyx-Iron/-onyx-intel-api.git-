import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { buildDocumentStatusSnapshot } from "@/lib/documents/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<unknown> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = (await params) as { id: string };
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data: document, error: documentError } = await db
      .from("documents")
      .select("id, file_name, status, doc_type, page_count, uploaded_at, processed_at, last_error, last_error_step, last_successful_step, processing_started_at, processing_completed_at, split_status, ocr_status, sheet_index_status, takeoff_status, vector_status, meta")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .single();
    if (documentError || !document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { data: events, error: eventsError } = await db
      .from("document_processing_events")
      .select("step, status, worker, attempt_number, error_code, error_message, started_at, completed_at")
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(25);
    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    return NextResponse.json(buildDocumentStatusSnapshot(document, events ?? []));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/status] ${msg}` }, { status: 500 });
  }
}
