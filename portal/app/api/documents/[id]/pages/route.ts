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
  };
}

function mapAsyncPage(ocrText: string | null, pageNumber: number): ParsedPageRow {
  const text = (ocrText ?? "").trim();
  if (!text) {
    return { page_number: pageNumber, summary: "", key_terms: [] };
  }
  const summary = text.length > 500 ? `${text.slice(0, 497)}…` : text;
  return { page_number: pageNumber, summary, key_terms: [] };
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

    const { data: syncPages, error: pagesErr } = await db
      .from("pages")
      .select("page_number, extracted_text")
      .eq("document_id", documentId)
      .eq("tenant_id", tenantId)
      .order("page_number", { ascending: true });
    if (pagesErr) {
      return NextResponse.json({ error: pagesErr.message }, { status: 500 });
    }

    let parsedPages: ParsedPageRow[] = (syncPages ?? []).map((p) =>
      mapSyncPage(p.extracted_text, p.page_number),
    );

    // Fallback: async page-split pipeline writes OCR to document_pages instead
    // of the sync ingest `pages` table.
    if (parsedPages.length === 0) {
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
      parsedPages = ((asyncPages ?? []) as Array<{ page_number: number; ocr_text: string | null; status: string }>)
        .filter((p) => p.status === "done" || (p.ocr_text ?? "").trim().length > 0)
        .map((p) => mapAsyncPage(p.ocr_text, p.page_number));
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
      pages: parsedPages,
      questions,
      classification,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents/:id/pages] ${msg}` }, { status: 500 });
  }
}
