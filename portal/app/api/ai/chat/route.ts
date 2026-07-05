import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { headerSafe } from "@/lib/http";
import { logEvent } from "@/lib/activity";
import { buildGroundedSystemPrompt } from "@/lib/ai/grounding";
import { generateText, availableProviders, NoProviderError, type Provider } from "@/lib/ai/providers";

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
  "You have access to tools that can search project documents, retrieve open RFIs, " +
  "fetch schedule tasks, and pull project data. Use them proactively when the question " +
  "requires specific project information. " +
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

function buildProjectBrief(p: ProjectRow, today: string): string {
  const lines: string[] = [`\n--- Active Project Context ---`];
  lines.push(`Project: ${p.name}`);
  const location = [p.address, p.city, p.state].filter(Boolean).join(", ");
  if (location) lines.push(`Location: ${location}`);
  lines.push(`Status: ${p.status}`);
  const meta = p.meta ?? {};
  const estimate = typeof meta.estimate === "number" ? meta.estimate : null;
  const completionPct = typeof meta.completion_pct === "number" ? meta.completion_pct : null;
  if (p.budget != null) {
    let budgetLine = `Budget: $${p.budget.toLocaleString()}`;
    if (estimate != null) {
      const variance = p.budget - estimate;
      const sign = variance >= 0 ? "+" : "-";
      budgetLine += ` | Estimate: $${estimate.toLocaleString()} | Variance: ${sign}$${Math.abs(variance).toLocaleString()}`;
    }
    lines.push(budgetLine);
  }
  if (completionPct != null) lines.push(`Completion: ${completionPct}%`);
  if (p.start_date || p.end_date) {
    const parts: string[] = [];
    if (p.start_date) parts.push(`Start: ${p.start_date}`);
    if (p.end_date) {
      parts.push(`End: ${p.end_date}`);
      const daysRemaining = Math.ceil(
        (new Date(p.end_date).getTime() - new Date(today).getTime()) / 86_400_000,
      );
      parts.push(daysRemaining > 0 ? `${daysRemaining}d remaining` : `${Math.abs(daysRemaining)}d overdue`);
    }
    lines.push(parts.join(" | "));
  }
  lines.push(`Today: ${today}`);
  lines.push(`--- End Project Context ---`);
  return lines.join("\n");
}

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
// Agentic tool declarations + executor
// -----------------------------------------------------------------------------

const TOOL_DECLARATIONS = [
  {
    name: "search_project_docs",
    description:
      "Semantically search indexed project documents (drawings, specs, submittals, contracts). " +
      "Use when the question involves document content, specifications, materials, quantities, or referenced sheets.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Natural language search query" } },
      required: ["query"],
    },
  },
  {
    name: "get_open_rfis",
    description:
      "Retrieve open, pending, or recently answered Requests for Information (RFIs) for this project. " +
      "Use when asked about unresolved questions, potential conflicts, clarifications needed, or RFI status.",
    parameters: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", description: "Filter by status: 'open', 'pending', 'answered', or 'all'. Default: 'all'" },
      },
      required: [],
    },
  },
  {
    name: "get_schedule_tasks",
    description:
      "Get schedule tasks and milestones for this project with dates, status, and assignments. " +
      "Use when asked about timelines, upcoming work, overdue items, or schedule risk.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: { type: "STRING", description: "Filter results: 'incomplete', 'overdue', 'upcoming_30d', or 'all'. Default: 'all'" },
      },
      required: [],
    },
  },
  {
    name: "get_project_data",
    description:
      "Get core project details: name, status, budget, estimate, completion percentage, start/end dates, " +
      "and document/task counts. Use when asked for project overview, budget, or key stats.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_related_specs",
    description:
      "Broad cross-reference sweep of all indexed spec sections related to a CSI division, trade, or topic. " +
      "Use when asked to summarize what the specs say about a division or system, compare requirements " +
      "across sections, or find all references to a material or trade. Returns up to 15 excerpts.",
    parameters: {
      type: "OBJECT",
      properties: {
        division: { type: "STRING", description: "CSI division number, trade name, or topic" },
        max_results: { type: "NUMBER", description: "How many spec excerpts to return. Default 10, max 15." },
      },
      required: ["division"],
    },
  },
];

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  projectId: string,
  citationsOut: Array<{ document_id: string; page_number: number; similarity: number }>,
): Promise<unknown> {
  switch (name) {
    case "search_project_docs": {
      const query = String(args.query ?? "").trim();
      if (!query) return "No query provided.";
      try {
        const embedding = await embedText(query);
        const vectorStr = `[${embedding.join(",")}]`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (db.rpc as any)("match_chunks", {
          query_embedding: vectorStr,
          match_tenant_id: tenantId,
          match_project_id: projectId,
          query_text: query,
          match_count: 6,
        }) as { data: ChunkRow[] | null };
        const chunks = (data ?? []).filter((c) => c.rrf_score > 0.010);
        if (chunks.length === 0) return "No relevant document excerpts found.";
        for (const c of chunks) {
          citationsOut.push({ document_id: c.document_id, page_number: c.page_number, similarity: c.similarity });
        }
        return chunks.map((c, i) => `[${i + 1}] (page:${c.page_number})\n${c.content}`).join("\n\n");
      } catch {
        return "Document search failed.";
      }
    }
    case "get_open_rfis": {
      const status = String(args.status ?? "all");
      let query = db
        .from("rfi_items")
        .select("id, title, status, description, created_at, due_date, assignee")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (status !== "all") query = query.eq("status", status);
      const { data } = await query;
      if (!data || data.length === 0) return "No RFIs found.";
      return data;
    }
    case "get_schedule_tasks": {
      const filter = String(args.filter ?? "all");
      let query = db
        .from("schedule_tasks")
        .select("id, title, status, start_date, end_date, assignee, notes")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .order("start_date", { ascending: true })
        .limit(40);
      const today = new Date().toISOString().split("T")[0];
      if (filter === "incomplete") {
        query = query.neq("status", "complete").neq("status", "done");
      } else if (filter === "overdue") {
        query = query.lt("end_date", today).neq("status", "complete").neq("status", "done");
      } else if (filter === "upcoming_30d") {
        const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
        query = query.gte("start_date", today).lte("start_date", thirtyDays);
      }
      const { data } = await query;
      if (!data || data.length === 0) return "No schedule tasks found.";
      return data;
    }
    case "get_project_data": {
      const { data } = await db
        .from("projects")
        .select("id, name, status, budget, estimate, completion_pct, start_date, end_date, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .eq("id", projectId)
        .single();
      return data ?? "Project not found.";
    }
    case "get_related_specs": {
      const division = String(args.division ?? "").trim();
      if (!division) return "No division or topic provided.";
      const maxResults = Math.min(Math.max(1, Number(args.max_results ?? 10)), 15);
      const CSI_NAMES: Record<string, string> = {
        "01": "general requirements", "02": "existing conditions site demolition",
        "03": "concrete cast-in-place reinforced", "04": "masonry brick block",
        "05": "metals structural steel framing", "06": "wood plastics composites rough carpentry",
        "07": "thermal moisture protection waterproofing roofing insulation",
        "08": "openings doors windows glazing", "09": "finishes flooring ceiling drywall paint",
        "10": "specialties", "11": "equipment", "12": "furnishings",
        "13": "special construction", "14": "conveying equipment elevators",
        "21": "fire suppression sprinkler", "22": "plumbing piping fixtures",
        "23": "HVAC heating ventilation air conditioning mechanical",
        "26": "electrical power lighting", "27": "communications low voltage",
        "28": "electronic safety security fire alarm", "31": "earthwork grading excavation",
        "32": "exterior improvements paving site concrete", "33": "utilities underground",
      };
      const numMatch = division.match(/\b(\d{1,2})\b/);
      const divNum = numMatch ? numMatch[1].padStart(2, "0") : null;
      const csiFull = divNum ? CSI_NAMES[divNum] : null;
      const searchQuery = csiFull
        ? `Division ${divNum} ${csiFull} specifications requirements`
        : `${division} specifications requirements`;
      try {
        const embedding = await embedText(searchQuery);
        const vectorStr = `[${embedding.join(",")}]`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (db.rpc as any)("match_chunks", {
          query_embedding: vectorStr,
          match_tenant_id: tenantId,
          match_project_id: projectId,
          query_text: searchQuery,
          match_count: maxResults,
        }) as { data: ChunkRow[] | null };
        if (!data || data.length === 0) {
          return `No indexed spec sections found for "${division}". Ensure spec documents are uploaded and indexed.`;
        }
        for (const c of data) {
          citationsOut.push({ document_id: c.document_id, page_number: c.page_number, similarity: c.similarity });
        }
        const label = csiFull ? `Division ${divNum} — ${csiFull}` : division;
        return (
          `Cross-reference: ${label}\n\n` +
          data.map((c, i) => `[${i + 1}] page ${c.page_number}\n${c.content}`).join("\n\n---\n\n")
        );
      } catch {
        return "Spec cross-reference search failed.";
      }
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
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

  let SYSTEM = SYSTEM_BASE + "\n\n" + buildProjectBrief(project as ProjectRow, today);
  if (convSummary) {
    SYSTEM += `\n\n--- Prior Conversation Summary ---\n${convSummary}\n--- End Summary ---`;
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
  const systemInstruction = SYSTEM_BASE_AGENTIC + "\n\n" + buildProjectBrief(project as ProjectRow, today);

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
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
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
        result = await executeTool(name, args, db, tenantId, project_id, agenticCitations);
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
      "X-Citations": JSON.stringify(enrichedCitations),
      "Access-Control-Expose-Headers": "X-Conversation-Id, X-Has-Context, X-Tool-Calls, X-Citations",
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

    if (mode === "agentic") {
      return await handleAgentic(tenantId, body.project_id, body.message, body.conversation_id);
    }
    return await handleRag(userId, tenantId, body.project_id, body.message, body.conversation_id);
  } catch (err: unknown) {
    if (err instanceof NoProviderError) {
      return NextResponse.json(
        { error: err.message, code: "NO_PROVIDER", available: availableProviders() },
        { status: 503 },
      );
    }
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
    const db = await createServiceClient();

    await db.from("messages").delete().eq("conversation_id", conversation_id).eq("tenant_id", tenantId);
    await db.from("conversations").delete().eq("id", conversation_id).eq("tenant_id", tenantId);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[ai/chat DELETE] ${msg}` }, { status: 500 });
  }
}
