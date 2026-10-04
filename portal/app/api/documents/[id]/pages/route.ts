import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

// Always read fresh — Insights panel is refreshed after every new Q&A answer
// and the cache must reflect the latest meta.questions immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ParsedPageRow {
  page_number: number;
  summary: string;
  key_terms: string[];
  status: string | null;
  error: string | null;
}

function mapSyncPage(extractedText: string | null, pageNumber: number): ParsedPageRow {
  const text = extractedText ?? "";
  const [summary, keyTermsLine] = text.split("\n");
  const keyTerms = keyTermsLine
    ? keyTermsLine.replace(/^Key terms:\s*/i, "").split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  return {
    page_number: pageNumber,
    summary: summary ?? "",
    key_terms: keyTerms,
    status: null,
    error: null,
  };
}

function mapAsyncPage(ocrText: string | null, pageNumber: number): ParsedPageRow {
  const text = (ocrText ?? "").trim();
  if (!text) {
    return { page_number: pageNumber, summary: "", key_terms: [], status: null, error: null };
  }
  const summary = text.length > 500 ? `${text.slice(0, 497)}…` : text;
  return { page_number: pageNumber, summary, key_terms: [], status: null, error: null };
}

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

    const { data: storedPages, error: asyncErr } = await db
      .from("document_pages")
      .select("page_number, ocr_text, status, error")
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .order("page_number", { ascending: true });
    if (asyncErr) {
      return NextResponse.json({ error: asyncErr.message }, { status: 500 });
    }

    const byNumber = new Map<number, ParsedPageRow>();
    for (const page of syncPages ?? []) {
      byNumber.set(page.page_number, mapSyncPage(page.extracted_text, page.page_number));
    }
    for (const page of storedPages ?? []) {
      const existing = byNumber.get(page.page_number);
      const fromOcr = mapAsyncPage(page.ocr_text, page.page_number);
      byNumber.set(page.page_number, {
        page_number: page.page_number,
        summary: existing?.summary || fromOcr.summary,
        key_terms: existing?.key_terms.length ? existing.key_terms : fromOcr.key_terms,
        status: page.status,
        error: page.error,
      });
    }
    const parsedPages = [...byNumber.values()].sort((a, b) => a.page_number - b.page_number);

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
      pages: parsedPages,
      questions,
      classification,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/pages] ${msg}` }, { status: 500 });
  }
}
