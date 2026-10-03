import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { headerSafe } from "@/lib/http";
import { logEvent } from "@/lib/activity";
import { auditDelete } from "@/lib/audit";
import { buildGroundedSystemPrompt } from "@/lib/ai/grounding";
import { generateText, availableProviders, NoProviderError, type Provider } from "@/lib/ai/providers";
import { buildProjectBrief } from "@/lib/ai/project-brief";
import {
  formatMemoriesBlock,
  isFinancialMemoryFact,
  listProjectMemories,
  memoriesForFinancialAccess,
} from "@/lib/ai/project-memories";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import {
  executeProjectSkill,
  PROJECT_SKILL_DECLARATIONS,
  skillLink,
  skillSectionGuide,
} from "@/lib/ai/project-skills";

export const runtime = "nodejs";
export const maxDuration = 120;

// =============================================================================
// Unified AI chat route — dispatches by `mode` in the request body.
//   - "assist":  stateless one-shot prompt (ask / draft_rfi / summarize / etc.)
//   - "rag":     streaming RAG chat with vector search + persistence (default)
//   - "agentic": streaming tool-use loop with persistence
// =============================================================================

const GEMINI_API_KEY = headerSafe(process.env.GEMINI_API_KEY);
const EMBED_MODEL = "text-embedding-004";
const CHAT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
const SUMMARY_MODEL = process.env.GEMINI_DIGEST_MODEL ?? "gemini-2.0-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const HISTORY_WINDOW = 12;
const SUMMARY_INTERVAL = 20;
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_BASE =
  "You are an expert construction project assistant for a general contractor. " +
  "Answer questions using the provided document excerpts when available. " +
  "Quote specific values, sheet numbers, or spec sections where relevant. " +
  "If the answer is not in the provided context, say so and offer general guidance. " +
  "Be concise and practical.";

const SYSTEM_BASE_AGENTIC =
  "You are an expert construction project assistant for a general contractor. " +
  "Use the project tools whenever a question depends on live records: documents, RFIs, submittals, " +
  "change orders, schedule, estimate, invoices, lien waivers, procurement, takeoff, logs, punch list, " +
  "to-dos, staff, or contacts. " +
  "Tools are read-only. Never claim you created, approved, awarded, or deleted a record. " +
  "If a tool returns no rows, say so. If financials_redacted is true, do not invent dollar amounts. " +
  "When the user should open a screen, include the open_in_app link from the tool result. " +
  "Quote specific values, sheet numbers, or spec sections where relevant. " +
  "Be concise and practical. After calling tools, synthesize findings into a clear answer.";

// Assist-mode prompts (formerly /api/ai/assist)
const ASSIST_MODES: Record<string, string> = {
  ask:
    "You are an expert construction project assistant for a general contractor. " +
    "Answer concisely and practically. When estimating or referencing codes, state assumptions.",
  draft_rfi:
    "You draft formal construction RFIs (Requests for Information). Output a complete RFI with: " +
    "Subject, RFI number placeholder, To/From, Date placeholder, Reference (spec/drawing), " +
    "Question (clear and specific), and Suggested Resolution. Professional, concise.",
  draft_submittal:
    "You draft construction submittal transmittals. Output: Project, Submittal number placeholder, " +
    "Spec Section, Description, Type (product data/shop drawing/sample), Action requested, and notes.",
  summarize:
    "You summarize construction documents (specs, meeting minutes, daily logs) into clear bullet points, " +
    "surfacing action items, responsibilities, and dates.",
  scope:
    "You write clear, itemized scopes of work organized by CSI division. Be specific about " +
    "inclusions and exclusions. Flag anything ambiguous that needs clarification.",
};

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  meta: Record<string, unknown> | null;
}

async function callerCanReadFinancial(tenantId: string, userId: string): Promise<boolean> {
  try {
    return canReadFinancial(await getUserRole(tenantId, userId));
  } catch {
    return false;
  }
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type CitationMeta = { document_id: string; page_number: number; similarity: number; file_name?: string };

interface ChunkRow {
  content: string;
  document_id: string;
  page_number: number;
  similarity: number;
  rrf_score: number;
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    `${GEMINI_BASE}/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    },
  );
  if (!res.ok) throw new Error(`Embed failed (${res.status})`);
  const data = await res.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichCitations(db: any, tenantId: string, citations: CitationMeta[]): Promise<CitationMeta[]> {
  if (citations.length === 0) return citations;
  try {
    const docIds = [...new Set(citations.map((c) => c.document_id))];
    const { data: docs } = await db
      .from("documents")
      .select("id, file_name")
      .in("id", docIds)
      .eq("tenant_id", tenantId);
    const nameMap = new Map((docs ?? []).map((d: { id: string; file_name: string }) => [d.id, d.file_name]));
    return citations.map((c) => ({ ...c, file_name: (nameMap.get(c.document_id) as string | undefined) ?? "Document" }));
  } catch {
    return citations;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function summarizeConversation(convId: string, tenantId: string, db: any, totalCount: number): Promise<void> {
  if (!GEMINI_API_KEY) return;
  try {
    const { data: oldMessages } = await db
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", convId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(Math.max(0, totalCount - HISTORY_WINDOW));

    if (!oldMessages || oldMessages.length < 8) return;

    const transcript = oldMessages
      .map((m: { role: string; content: string }) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const res = await fetch(
      `${GEMINI_BASE}/models/${SUMMARY_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{
              text: `Summarize this construction project conversation concisely. Focus on: decisions made, issues identified, information confirmed, and any open questions. Keep it under 200 words.\n\n${transcript}`,
            }],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
        }),
      },
    );

    if (!res.ok) return;
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!summary) return;

    await db
      .from("conversations")
      .update({ summary, message_count: totalCount } as never)
      .eq("id", convId)
      .eq("tenant_id", tenantId);
  } catch { /* non-fatal */ }
}

// -----------------------------------------------------------------------------
// Mode handlers
// -----------------------------------------------------------------------------

interface AssistBody {
  mode: "assist";
  prompt: string;
  context?: string;
  assist_mode?: string;     // "ask" | "draft_rfi" | "summarize" | "scope" | "draft_submittal"
  provider?: Provider;
  json?: boolean;
}

async function handleAssist(body: AssistBody): Promise<NextResponse> {
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const system = buildGroundedSystemPrompt(ASSIST_MODES[body.assist_mode ?? "ask"] ?? ASSIST_MODES.ask);
  const prompt = body.context ? `Context:\n${body.context}\n\n---\n\n${body.prompt}` : body.prompt;
  const result = await generateText({
    system,
    prompt,
    provider: body.provider,
    json: body.json,
    maxTokens: 4096,
  });
  return NextResponse.json({ text: result.text, provider: result.provider, model: result.model });
}

async function handleRag(
  userId: string,
  tenantId: string,
  project_id: string,
  message: string,
  conversation_id: string | undefined,
): Promise<Response> {
  const db = await createServiceClient();

  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, name, status, budget, start_date, end_date, address, city, state, meta")
    .eq("id", project_id)
    .eq("tenant_id", tenantId)
    .single();
  if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const today = new Date().toISOString().split("T")[0];

  let convId = conversation_id;
  let convSummary: string | null = null;
  let currentMessageCount = 0;

  if (!convId) {
    const { data: conv, error: convErr } = await db
      .from("conversations")
      .insert({ project_id, tenant_id: tenantId })
      .select("id")
      .single();
    if (convErr || !conv) return NextResponse.json({ error: "Could not create conversation" }, { status: 500 });
    convId = conv.id;
  } else {
    const { data: convData } = await db
      .from("conversations")
      .select("summary, message_count")
      .eq("id", convId)
      .eq("tenant_id", tenantId)
      .single();
    const row = convData as { summary?: string | null; message_count?: number | null } | null;
    convSummary = row?.summary ?? null;
    currentMessageCount = row?.message_count ?? 0;
  }

  const allowMoney = await callerCanReadFinancial(tenantId, userId);
  let SYSTEM = SYSTEM_BASE + "\n\n" + buildProjectBrief(project as ProjectRow, today, allowMoney);
  if (convSummary && (allowMoney || !isFinancialMemoryFact(convSummary))) {
    SYSTEM += `\n\n--- Prior Conversation Summary ---\n${convSummary}\n--- End Summary ---`;
  }
  try {
    const memories = await listProjectMemories(db, tenantId, project_id, 30);
    SYSTEM += formatMemoriesBlock(memoriesForFinancialAccess(memories, allowMoney));
  } catch {
    // non-fatal — chat still works without the memory block
  }

  await db.from("messages").insert({
    conversation_id: convId,
    tenant_id: tenantId,
    role: "user",
    content: message.trim(),
    citations: [],
  });

  const { data: history, count: totalMessages } = await db
    .from("messages")
    .select("role, content", { count: "exact" })
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_WINDOW);

  const priorMessages: ChatMessage[] = (history ?? []).map((m: { role: string; content: string }) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  let contextBlock = "";
  let citationMeta: CitationMeta[] = [];

  try {
    const embedding = await embedText(message.trim());
    const vectorStr = `[${embedding.join(",")}]`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chunks } = await (db.rpc as any)("match_chunks", {
      query_embedding: vectorStr,
      match_tenant_id: tenantId,
      match_project_id: project_id,
      query_text: message.trim(),
      match_count: 6,
    }) as { data: ChunkRow[] | null };

    if (chunks && chunks.length > 0) {
      const relevant = chunks.filter((c) => c.rrf_score > 0.010);
      if (relevant.length > 0) {
        contextBlock =
          "=== Relevant document excerpts ===\n" +
          relevant.map((c, i) => `[${i + 1}] (page ${c.page_number})\n${c.content}`).join("\n\n") +
          "\n=== End of excerpts ===\n\n";
        citationMeta = relevant.map((c) => ({
          document_id: c.document_id,
          page_number: c.page_number,
          similarity: c.similarity,
        }));
      }
    }
  } catch { /* non-fatal */ }

  citationMeta = await enrichCitations(db, tenantId, citationMeta);

  const contents = [
    ...priorMessages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user" as const, parts: [{ text: contextBlock + message.trim() }] },
  ];

  const geminiRes = await fetch(
    `${GEMINI_BASE}/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    },
  );

  if (!geminiRes.ok || !geminiRes.body) {
    const detail = await geminiRes.text().catch(() => geminiRes.statusText);
    return NextResponse.json({ error: `[gemini ${geminiRes.status}] ${detail.slice(0, 300)}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const geminiReader = geminiRes.body.getReader();
  const geminiDecoder = new TextDecoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let fullText = "";

  (async () => {
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await geminiReader.read();
        if (done) break;
        buffer += geminiDecoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
            if (text) {
              fullText += text;
              await writer.write(encoder.encode(text));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error("[ai/chat rag stream]", err);
    } finally {
      await writer.close().catch(() => {});
      if (fullText) {
        try {
          await db.from("messages").insert({
            conversation_id: convId!,
            tenant_id: tenantId,
            role: "assistant",
            content: fullText,
            citations: citationMeta,
          });

          void logEvent({
            projectId: project_id,
            tenantId,
            userId,
            entityType: "ai_chat",
            entityId: convId ?? undefined,
            action: "created",
            title: `AI chat: "${message.trim().slice(0, 80)}${message.trim().length > 80 ? "…" : ""}"`,
            meta: { has_citations: citationMeta.length > 0, citation_count: citationMeta.length },
          });

          const newTotal = (totalMessages ?? 0) + 1;
          const shouldSummarize =
            newTotal >= SUMMARY_INTERVAL &&
            newTotal - currentMessageCount >= SUMMARY_INTERVAL;
          if (shouldSummarize) {
            void summarizeConversation(convId!, tenantId, db, newTotal);
          }
        } catch (e) {
          console.error("[ai/chat rag save]", e);
        }
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": convId!,
      "X-Has-Context": String(citationMeta.length > 0),
      "X-Citations": JSON.stringify(citationMeta),
      "Access-Control-Expose-Headers": "X-Conversation-Id, X-Has-Context, X-Citations",
    },
  });
}

async function handleAgentic(
  userId: string,
  tenantId: string,
  project_id: string,
  message: string,
  conversation_id: string | undefined,
): Promise<Response> {
  const db = await createServiceClient();

  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, name, status, budget, start_date, end_date, address, city, state, meta")
    .eq("id", project_id)
    .eq("tenant_id", tenantId)
    .single();
  if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const today = new Date().toISOString().split("T")[0];
  const allowMoney = await callerCanReadFinancial(tenantId, userId);
  let systemInstruction = SYSTEM_BASE_AGENTIC + "\n\n" + buildProjectBrief(project as ProjectRow, today, allowMoney);
  systemInstruction += "\n\n" + skillSectionGuide(project_id);
  try {
    const memories = await listProjectMemories(db, tenantId, project_id, 30);
    systemInstruction += formatMemoriesBlock(memoriesForFinancialAccess(memories, allowMoney));
  } catch {
    // non-fatal
  }

  let convId = conversation_id;
  if (!convId) {
    const { data: conv, error: convErr } = await db
      .from("conversations")
      .insert({ project_id, tenant_id: tenantId })
      .select("id")
      .single();
    if (convErr || !conv) return NextResponse.json({ error: "Could not create conversation" }, { status: 500 });
    convId = conv.id;
  }

  await db.from("messages").insert({
    conversation_id: convId,
    tenant_id: tenantId,
    role: "user",
    content: message.trim(),
    citations: [],
  });

  const { data: history } = await db
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(20);

  const priorHistory = (history ?? []).slice(0, -1);
  const contents: GeminiContent[] = [
    ...priorHistory.map((m: { role: string; content: string }) => ({
      role: (m.role === "user" ? "user" : "model") as "user" | "model",
      parts: [{ text: m.content }],
    })),
    { role: "user" as const, parts: [{ text: message.trim() }] },
  ];

  const toolCallLog: string[] = [];
  const agenticCitations: Array<{ document_id: string; page_number: number; similarity: number }> = [];
  let round = 0;
  let finalText = "";

  while (round < MAX_TOOL_ROUNDS) {
    round++;
    const geminiRes = await fetch(
      `${GEMINI_BASE}/models/${CHAT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools: [{ functionDeclarations: PROJECT_SKILL_DECLARATIONS }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
      },
    );
    if (!geminiRes.ok) {
      const detail = await geminiRes.text().catch(() => geminiRes.statusText);
      return NextResponse.json({ error: `[gemini ${geminiRes.status}] ${detail.slice(0, 300)}` }, { status: 502 });
    }
    const geminiData = await geminiRes.json() as {
      candidates?: Array<{ content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }>;
    };
    const candidate = geminiData.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const modelRole = (candidate?.content?.role ?? "model") as "user" | "model";

    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (functionCalls.length === 0) {
      finalText = textParts.map((p) => p.text ?? "").join("");
      break;
    }

    contents.push({ role: modelRole, parts });

    const responseParts: GeminiPart[] = [];
    for (const part of functionCalls) {
      if (!part.functionCall) continue;
      const { name, args } = part.functionCall;
      toolCallLog.push(name);
      let result: unknown;
      try {
        result = await executeProjectSkill(name, args ?? {}, db, {
          tenantId,
          projectId: project_id,
          canReadFinancial: allowMoney,
          citationsOut: agenticCitations,
          embedText,
        });
      } catch (e) {
        result = { error: String(e) };
      }
      responseParts.push({
        functionResponse: {
          name,
          response: { content: typeof result === "string" ? result : JSON.stringify(result) },
        },
      });
    }
    contents.push({ role: "user" as const, parts: responseParts });
  }

  if (!finalText) finalText = "(No response generated after tool loop)";

  const enrichedCitations = await enrichCitations(db, tenantId, agenticCitations.map((c) => ({ ...c })));

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    try {
      const CHUNK = 40;
      for (let i = 0; i < finalText.length; i += CHUNK) {
        await writer.write(encoder.encode(finalText.slice(i, i + CHUNK)));
      }
    } finally {
      await writer.close().catch(() => {});
      try {
        await db.from("messages").insert({
          conversation_id: convId!,
          tenant_id: tenantId,
          role: "assistant",
          content: finalText,
          citations: enrichedCitations,
        });
      } catch (e) {
        console.error("[ai/chat agentic save]", e);
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": convId!,
      "X-Has-Context": String(enrichedCitations.length > 0 || toolCallLog.length > 0),
      "X-Tool-Calls": toolCallLog.join(","),
      "X-Skill-Links": encodeURIComponent(JSON.stringify(
        toolCallLog.map((skill) => skillLink(project_id, skill)).filter((link) => link !== null),
      )),
      "X-Citations": JSON.stringify(enrichedCitations),
      "Access-Control-Expose-Headers": "X-Conversation-Id, X-Has-Context, X-Tool-Calls, X-Skill-Links, X-Citations",
    },
  });
}

// -----------------------------------------------------------------------------
// Public handlers
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const email = (await currentUser())?.primaryEmailAddress?.emailAddress;

    const body = await req.json() as {
      mode?: "assist" | "rag" | "agentic";
      // assist fields
      prompt?: string;
      context?: string;
      assist_mode?: string;
      provider?: Provider;
      json?: boolean;
      // rag / agentic fields
      project_id?: string;
      message?: string;
      conversation_id?: string;
    };

    const mode = body.mode ?? "rag";

    if (mode === "assist") {
      if (!body.prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
      const assistRl = await checkAiRateLimit(authTenantKey(userId, orgId), "ai/chat:assist", { windowMs: 60_000, max: 20 }, email);
      if (!assistRl.ok) {
        return NextResponse.json(
          { error: "Too many AI requests — please slow down." },
          { status: 429, headers: { "Retry-After": String(assistRl.retryAfterSeconds) } },
        );
      }
      return await handleAssist({
        mode: "assist",
        prompt: body.prompt,
        context: body.context,
        assist_mode: body.assist_mode,
        provider: body.provider,
        json: body.json,
      });
    }

    // rag and agentic both need Gemini + project + message
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "AI not configured (GEMINI_API_KEY missing).", code: "NO_PROVIDER" }, { status: 503 });
    }
    if (!body.project_id || !body.message?.trim()) {
      return NextResponse.json({ error: "project_id and message are required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try {
      await assertProjectBelongsToTenant(body.project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    // Agentic mode fires up to MAX_TOOL_ROUNDS extra LLM calls per message —
    // throttle it harder than a single rag turn.
    const chatRl = await checkAiRateLimit(tenantId, `ai/chat:${mode}`, {
      windowMs: 60_000,
      max: mode === "agentic" ? 10 : 20,
    }, email);
    if (!chatRl.ok) {
      return NextResponse.json(
        { error: "Too many AI requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(chatRl.retryAfterSeconds) } },
      );
    }

    if (mode === "agentic") {
      return await handleAgentic(userId, tenantId, body.project_id, body.message, body.conversation_id);
    }
    return await handleRag(userId, tenantId, body.project_id, body.message, body.conversation_id);
  } catch (err: unknown) {
    if (err instanceof NoProviderError) {
      return NextResponse.json(
        { error: err.message, code: "NO_PROVIDER", available: availableProviders() },
        { status: 503 },
      );
    }
    const owned = ownershipDenied(err);
    if (owned) return owned;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[ai/chat] ${msg}` }, { status: 500 });
  }
}

// GET: load conversation history (unchanged), OR provider status when ?status=1
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);

    // Provider status check (formerly GET /api/ai/assist)
    if (searchParams.get("status") === "1" || searchParams.get("providers") === "1") {
      return NextResponse.json({ providers: availableProviders() });
    }

    const project_id = searchParams.get("project_id");
    const conversation_id = searchParams.get("conversation_id");

    if (!project_id) {
      // Backwards-compat: bare GET returns provider status (assist GET behavior)
      return NextResponse.json({ providers: availableProviders() });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    if (conversation_id) {
      const { data: messages } = await db
        .from("messages")
        .select("id, role, content, citations, created_at")
        .eq("conversation_id", conversation_id)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });
      return NextResponse.json({ messages: messages ?? [] });
    }

    const { data: conv } = await db
      .from("conversations")
      .select("id, created_at")
      .eq("project_id", project_id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conv) return NextResponse.json({ conversation_id: null, messages: [] });

    const { data: messages } = await db
      .from("messages")
      .select("id, role, content, citations, created_at")
      .eq("conversation_id", conv.id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    return NextResponse.json({ conversation_id: conv.id, messages: messages ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[ai/chat GET] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { conversation_id } = await req.json() as { conversation_id?: string };
    if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const { data: before } = await db
      .from("conversations")
      .select("*")
      .eq("id", conversation_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    await db.from("messages").delete().eq("conversation_id", conversation_id).eq("tenant_id", tenantId);
    await db.from("conversations").delete().eq("id", conversation_id).eq("tenant_id", tenantId);

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "conversations",
      record_id: conversation_id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[ai/chat DELETE] ${msg}` }, { status: 500 });
  }
}
