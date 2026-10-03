import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildGroundedSystemPrompt } from "@/lib/ai/grounding";
import { getAccessToken } from "@/lib/google/oauth";
import { headerSafe } from "@/lib/http";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate } from "@/lib/audit";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const GEMINI_API_KEY = headerSafe(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
const DEFAULT_BUCKET = "plans-bucket";

const SYSTEM =
  "You are a construction document assistant. Answer the user's question using ONLY the attached " +
  "document. Quote specific sections, sheet numbers, or values where possible. If the answer is not " +
  "in the document, say so plainly — do not guess.";

/**
 * Document Q&A — downloads a stored PDF and lets Gemini read it natively to
 * answer a question about it. Tenant-isolated; only works on docs with a
 * Supabase storage_path (uploaded files, not Drive-only imports).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const email = (await currentUser())?.primaryEmailAddress?.emailAddress;

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "AI is not configured (GEMINI_API_KEY missing).", code: "NO_PROVIDER" }, { status: 503 });
    }

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
      .select("id, file_name, meta")
      .eq("id", document_id)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta ?? {}) as Record<string, unknown>;

    // Short-circuit repeat/duplicate questions about the same document — this
    // route sends the ENTIRE PDF to Gemini on every call (see below), so
    // re-asking a question a user already asked would otherwise re-upload and
    // reprocess the full file for an answer we already have.
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
    const storagePath = meta.storage_path as string | undefined;
    const driveFileId = meta.drive_file_id as string | undefined;
    let bytes: Buffer;
    let contentType = "application/pdf";

    if (storagePath) {
      if (!doc.file_name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Document Q&A currently supports PDF files only." }, { status: 422 });
      }
      // Prefer the bucket recorded on the row; fall back to plans-bucket
      // (async page-split path) then legacy project-documents.
      const metaBucket = typeof meta.storage === "string" && meta.storage !== "drive" && meta.storage !== "supabase"
        ? meta.storage
        : DEFAULT_BUCKET;
      const bucketsToTry = metaBucket === "project-documents"
        ? [metaBucket, DEFAULT_BUCKET]
        : [metaBucket, "project-documents"];
      let fileData: Blob | null = null;
      let dlErr: { message?: string } | null = null;
      for (const bucket of bucketsToTry) {
        const dl = await db.storage.from(bucket).download(storagePath);
        if (!dl.error && dl.data) {
          fileData = dl.data;
          dlErr = null;
          break;
        }
        dlErr = dl.error;
      }
      if (!fileData) return NextResponse.json({ error: `Could not load file: ${dlErr?.message ?? "not found"}` }, { status: 502 });
      bytes = Buffer.from(await fileData.arrayBuffer());
      contentType = "application/pdf";
    } else if (driveFileId) {
      const token = await getAccessToken(tenantId, userId);
      if (!token) {
        return NextResponse.json({ error: "Google Drive is connected in the database, but no refresh token is available yet. Reconnect Google." }, { status: 422 });
      }
      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!driveRes.ok) {
        const detail = await driveRes.text().catch(() => driveRes.statusText);
        return NextResponse.json({ error: `[drive ${driveRes.status}] ${detail.slice(0, 200)}` }, { status: 502 });
      }
      contentType = driveRes.headers.get("content-type") || "application/pdf";
      bytes = Buffer.from(await driveRes.arrayBuffer());
      if (!contentType.includes("pdf") && !doc.file_name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Document Q&A currently supports PDF files only." }, { status: 422 });
      }
    } else {
      return NextResponse.json({ error: "This document has no stored file or Drive file id to read." }, { status: 422 });
    }

    if (bytes.byteLength > 32 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF exceeds 32 MB — too large for Q&A." }, { status: 413 });
    }
    const base64 = bytes.toString("base64");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: buildGroundedSystemPrompt(SYSTEM, { requireCitations: true, sourceLabel: "attached document" }) }] },
          contents: [{
            role: "user",
            parts: [
              { inline_data: { mime_type: "application/pdf", data: base64 } },
              { text: question },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      return NextResponse.json({ error: `[gemini ${res.status}] ${detail.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const answer = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "(no answer)";

    // Persist Q&A to documents.meta.questions so it survives panel close + reload
    const newQ = {
      id: `q_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      question: question.trim(),
      answer,
      asked_at: new Date().toISOString(),
      asked_by: userId,
    };
    const updatedMeta = { ...meta, questions: [...existingQsForCache, newQ] };
    await db
      .from("documents")
      .update({ meta: updatedMeta } as never)
      .eq("id", doc.id)
      .eq("tenant_id", tenantId);

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "documents",
      record_id: doc.id,
      old_values: { meta } as unknown as Record<string, unknown>,
      new_values: { meta: updatedMeta } as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ answer, document: doc.file_name, question_id: newQ.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/ask] ${msg}` }, { status: 502 });
  }
}
