import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateText, NoProviderError, availableProviders } from "@/lib/ai/providers";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { getDocTypeByKey } from "@/lib/ai/generatedDocTypes";
import { createGoogleDocInProjectFolder } from "@/lib/google/projectFolder";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

const FALLBACK_SYSTEM = "You are an expert construction project assistant. Produce a clear, professional document.";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    const { data, error } = await db
      .from("generated_documents")
      .select("*").eq("tenant_id", tenantId).eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: `[GET /api/generated-docs] ${error.message}` }, { status: 500 });
    return NextResponse.json({ docs: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      project_id: string; doc_type?: string; title?: string; prompt?: string; context?: string;
      source_document_id?: string;
      provider?: "gemini" | "openai" | "anthropic";
    };
    if (!body.project_id) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(body.project_id, tenantId);

    const docType = body.doc_type ?? "other";
    const typeDef = getDocTypeByKey(docType);
    const system = typeDef?.systemPrompt ?? FALLBACK_SYSTEM;
    // If caller didn't supply a prompt, use the template for this doc type
    const userPrompt = body.prompt?.trim() || typeDef?.promptTemplate() || "Generate the requested document.";

    // If source_document_id is provided, pull its parsed summary/pages as context
    let extraContext = "";
    if (body.source_document_id) {
      try {
        const ctxDb = await createServiceClient();
        const { data: src } = await ctxDb
          .from("documents")
          .select("file_name, doc_type, meta, page_count")
          .eq("id", body.source_document_id)
          .eq("tenant_id", tenantId)
          .eq("project_id", body.project_id)
          .single();
        const { data: pages } = await ctxDb
          .from("pages")
          .select("page_number, extracted_text")
          .eq("document_id", body.source_document_id)
          .eq("tenant_id", tenantId)
          .order("page_number")
          .limit(50);
        if (src) {
          const meta = (src.meta ?? {}) as Record<string, unknown>;
          extraContext += `\n=== Source Document ===\n`;
          extraContext += `Filename: ${src.file_name}\n`;
          if (src.doc_type) extraContext += `Type: ${src.doc_type}\n`;
          if (meta.inferred_title) extraContext += `Title: ${meta.inferred_title}\n`;
          if (src.page_count) extraContext += `Pages: ${src.page_count}\n`;
          if (pages && pages.length > 0) {
            extraContext += "\n--- Page Summaries ---\n";
            // Cap per-page text to avoid runaway prompt size on big PDFs
            for (const p of pages) {
              const txt = (p.extracted_text ?? "").slice(0, 800);
              extraContext += `\nPage ${p.page_number}: ${txt}\n`;
              if (extraContext.length > 40_000) break;
            }
          }
        }
      } catch { /* best effort — fall back to no source context */ }
    }

    const fullContext = [body.context, extraContext].filter(Boolean).join("\n\n");
    const finalPrompt = fullContext ? `Context:\n${fullContext}\n\n---\n\n${userPrompt}` : userPrompt;

    let result;
    try {
      result = await generateText({
        system,
        prompt: finalPrompt,
        provider: body.provider,
        maxTokens: 4096,
      });
    } catch (e) {
      if (e instanceof NoProviderError) {
        return NextResponse.json({ error: e.message, code: "NO_PROVIDER", available: availableProviders() }, { status: 503 });
      }
      throw e;
    }

    const db = await createServiceClient();
    const title = body.title?.trim() || `${docType.toUpperCase()} — ${new Date().toLocaleDateString("en-US")}`;

    const { data, error } = await db
      .from("generated_documents")
      .insert({
        tenant_id: tenantId, project_id: body.project_id,
        doc_type: docType, title, content: result.text,
        provider: result.provider, created_by: userId,
      })
      .select().single();
    if (error) return NextResponse.json({ error: `[POST /api/generated-docs] ${error.message}` }, { status: 422 });

    // Best-effort: autosave to the project's Drive folder so the user has a
    // Google Doc copy in their plans hierarchy. Failures don't affect the DB save.
    const drive = await createGoogleDocInProjectFolder(
      tenantId,
      userId,
      body.project_id,
      title,
      result.text,
    );

    let docOut = data as Record<string, unknown>;
    if (drive) {
      const existingMeta = ((data as Record<string, unknown>).meta ?? {}) as Record<string, unknown>;
      const newMeta = {
        ...existingMeta,
        drive_file_id: drive.documentId,
        drive_url: drive.url,
        drive_folder_id: drive.folderId,
        drive_saved_at: new Date().toISOString(),
      };
      const { data: updated } = await db
        .from("generated_documents")
        .update({ meta: newMeta } as never)
        .eq("id", (data as { id: string }).id)
        .select()
        .single();
      if (updated) docOut = updated as Record<string, unknown>;
    }

    return NextResponse.json({ doc: docOut, drive_saved: !!drive }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/generated-docs] ${msg}` }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 502 });
  }
}
