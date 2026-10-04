import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate } from "@/lib/audit";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { excerptsForQuestion, formatExcerpts, type TextPage } from "@/lib/documents/text-excerpts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Document Q&A searches text already stored for the file and returns the
 * matching excerpts with their page numbers.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const email = (await currentUser())?.primaryEmailAddress?.emailAddress;

    const { document_id, question } = await req.json() as { document_id?: string; question?: string };
    if (!document_id || !question?.trim()) {
      return NextResponse.json({ error: "document_id and question are required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const { data: doc, error } = await db
      .from("documents")
      .select("id, file_name, project_id, meta")
      .eq("id", document_id)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const normalizedQuestion = question.trim().toLowerCase();
    const existingQsForCache = Array.isArray(meta.questions) ? meta.questions as Array<Record<string, unknown>> : [];
    const cached = existingQsForCache.find(
      (q) => typeof q.question === "string" && q.question.trim().toLowerCase() === normalizedQuestion,
    );
    if (cached) {
      return NextResponse.json({ answer: cached.answer, document: doc.file_name, question_id: cached.id, cached: true });
    }

    const rl = await checkAiRateLimit(tenantId, "documents/ask", { windowMs: 60_000, max: 8 }, email);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many document Q&A requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const pages = await loadStoredText(db, tenantId, document_id);
    const answer = formatExcerpts(excerptsForQuestion(pages, question));

    const newQ = {
      id: `q_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      question: question.trim(),
      answer,
      asked_at: new Date().toISOString(),
      asked_by: userId,
    };
    const updatedMeta = { ...meta, questions: [...existingQsForCache, newQ] };
    await db.from("documents").update({ meta: updatedMeta } as never).eq("id", doc.id).eq("tenant_id", tenantId);
    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "documents",
      record_id: doc.id,
      old_values: { meta } as unknown as Record<string, unknown>,
      new_values: { meta: updatedMeta } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ answer, document: doc.file_name, question_id: newQ.id, source: "stored_text" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/ask] ${msg}` }, { status: 502 });
  }
}

async function loadStoredText(
  db: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  documentId: string,
): Promise<TextPage[]> {
  const byPage = new Map<number, string[]>();
  const add = (pageNumber: number | null | undefined, text: string | null | undefined) => {
    const clean = (text ?? "").trim();
    if (pageNumber == null || !clean || !Number.isFinite(pageNumber)) return;
    const list = byPage.get(pageNumber) ?? [];
    list.push(clean);
    byPage.set(pageNumber, list);
  };

  const { data: syncChunks } = await db
    .from("chunks")
    .select("page_number, content")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  for (const row of syncChunks ?? []) add(row.page_number, row.content);

  const { data: pageChunks } = await db
    .from("document_chunks")
    .select("page_number, content")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  for (const row of pageChunks ?? []) {
    if (row.page_number != null) add(row.page_number, row.content);
  }

  const { data: ocrPages } = await db
    .from("document_pages")
    .select("page_number, ocr_text")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId)
    .not("ocr_text", "is", null);
  for (const row of ocrPages ?? []) add(row.page_number, row.ocr_text);

  const { data: extracted } = await db
    .from("pages")
    .select("page_number, extracted_text")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId);
  for (const row of extracted ?? []) add(row.page_number, row.extracted_text);

  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page_number, parts]) => ({ page_number, text: parts.join("\n") }));
}
