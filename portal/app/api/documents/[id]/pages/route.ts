import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

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

    // Sync Gemini ingest writes `pages`; async page-split writes `document_pages`.
    // Prefer sync rows when present, otherwise surface OCR text from the async path.
    const { data: syncPages, error: pagesErr } = await db
      .from("pages")
      .select("page_number, extracted_text")
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .order("page_number", { ascending: true });
    if (pagesErr) {
      return NextResponse.json({ error: pagesErr.message }, { status: 500 });
    }

    let insightPages: Array<{ page_number: number; summary: string; key_terms: string[] }> = [];

    if ((syncPages ?? []).length > 0) {
      insightPages = (syncPages ?? []).map((p) => {
        const text = p.extracted_text ?? "";
        const [summary, keyTermsLine] = text.split("\n");
        const key_terms = keyTermsLine
          ? keyTermsLine.replace(/^Key terms:\s*/i, "").split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        return {
          page_number: p.page_number,
          summary: summary ?? "",
          key_terms,
        };
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: asyncPages, error: asyncErr } = await (db as any)
        .from("document_pages")
        .select("page_number, ocr_text, status")
        .eq("document_id", documentId)
        .eq("tenant_id", tenantId)
        .order("page_number", { ascending: true });
      if (asyncErr) {
        return NextResponse.json({ error: asyncErr.message }, { status: 500 });
      }
      insightPages = ((asyncPages ?? []) as Array<{ page_number: number; ocr_text: string | null; status: string | null }>)
        .filter((p) => p.status === "done" || (p.ocr_text && p.ocr_text.trim().length > 0))
        .map((p) => {
          const text = (p.ocr_text ?? "").trim();
          const summary = text
            ? (text.length > 400 ? `${text.slice(0, 400)}…` : text)
            : "";
          return {
            page_number: p.page_number,
            summary,
            key_terms: [] as string[],
          };
        });
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
      pages: insightPages,
      questions,
      classification,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/pages] ${msg}` }, { status: 500 });
  }
}
