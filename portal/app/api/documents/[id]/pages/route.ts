import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { mergeInsightPages } from "@/lib/documents/insight-pages";

// Always read fresh — Insights panel is refreshed after every new Q&A answer
// and the cache must reflect the latest meta.questions immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data: doc, error: docErr } = await db
      .from("documents")
      .select("id, file_name, doc_type, page_count, status, meta, processed_at")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .single();
    if (docErr || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const [{ data: pages, error: pagesErr }, { data: sheetPages, error: sheetErr }] = await Promise.all([
      db.from("pages")
        .select("page_number, extracted_text")
        .eq("document_id", documentId)
        .eq("tenant_id", tenantId)
        .order("page_number", { ascending: true }),
      db.from("document_pages")
        .select("page_number, ocr_text")
        .eq("document_id", documentId)
        .eq("tenant_id", tenantId)
        .order("page_number", { ascending: true }),
    ]);
    if (pagesErr) {
      return NextResponse.json({ error: pagesErr.message }, { status: 500 });
    }
    if (sheetErr) {
      return NextResponse.json({ error: sheetErr.message }, { status: 500 });
    }

    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const questions = Array.isArray(meta.questions)
      ? (meta.questions as Array<{ id?: string; question?: string; answer?: string; asked_at?: string }>)
          .map((q) => ({
            id: q.id ?? "",
            question: q.question ?? "",
            answer: q.answer ?? "",
            asked_at: q.asked_at ?? "",
          }))
      : [];

    // Surface human-readable classification meta saved by other ingest pipelines
    const classification: Record<string, string> = {};
    const META_KEYS_OF_INTEREST: Record<string, string> = {
      title: "Title",
      inferred_title: "Inferred title",
      plan_set_label: "Plan set",
      family_key: "Family",
      revision_token: "Revision",
      revision_rank: "Revision rank",
      source: "Source",
      content_type: "Content type",
    };
    for (const [key, label] of Object.entries(META_KEYS_OF_INTEREST)) {
      const v = meta[key];
      if (v != null && v !== "") classification[label] = String(v);
    }

    return NextResponse.json({
      document: doc,
      pages: mergeInsightPages(pages ?? [], sheetPages ?? []),
      questions,
      classification,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/pages] ${msg}` }, { status: 500 });
  }
}
