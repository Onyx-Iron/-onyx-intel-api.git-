import { chatText, repairJSON } from "./providers.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgent, AGENTS } from "./agents/index.js";
import { getProjectContext } from "./project-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_FILE = path.join(__dirname, "../data/company-context.json");

function getCompanyContext() {
  try { return JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf8")); } catch { return null; }
}

// ── System prompts ───────────────────────────────────────────────
// Methodology imported from agents/index.js — duplicated here for the fallback prompt
const METHODOLOGY_FALLBACK = `HOW TO APPROACH EVERY QUESTION:
1. READ THE PROJECT FIRST — survey the full document library before answering. Identify which documents contain the information you need.
2. FOLLOW THE DRAWING LOGIC — drawings reference each other. Follow cross-references between sheets until the chain is complete.
3. USE SCALE AND GEOMETRY — use title block scale, labeled dimensions, and known reference points to derive measurements. Show all math.
4. APPLY CONSTRUCTION KNOWLEDGE — interpret what you find using deep knowledge of trade practices, codes, drawing conventions, and estimating methodology.
5. CROSS-REFERENCE ACROSS DISCIPLINES — compare architectural, structural, and MEP simultaneously. The answer is almost never on one sheet.
6. CITE EVERYTHING — tie every finding to a specific document and page. State assumptions explicitly. Never guess.
7. STRUCTURE OUTPUT FOR CONSTRUCTION USE — CSI structure for estimates, CPM logic for schedules, proper RFI workflow for logs.`;

const SYSTEM_CLAUDE = `You are the Onyx Intel AI Agent for Onyx & Iron Construction — a DFW Texas commercial and residential construction company. You are a senior construction manager, estimator, PM, and field superintendent with 20+ years of experience.

${METHODOLOGY_FALLBACK}

TOOLS AVAILABLE (use them when asked or when they would clearly help):

— Document & Project Tools —
- create_document(type, fields) — type: rfi | po | wo | co | submittal | estimate | daily | meeting | schedule | bid
- add_takeoff_item(type, label, quantity, unit, rate, notes)
- update_project(field, value)
- generate_estimate(items)
- search_plans(query)

— Communication & Contacts —
- draft_email(to, subject, body, cc) — creates a Gmail draft
- search_emails(query) — search Gmail inbox
- send_outlook_email(to, subject, body) — send via Microsoft Outlook
- get_contacts(query) — search Google Contacts
- sync_contacts_to_project() — import Google contacts into current project
- send_sms(to, message) — send SMS via Twilio (phone number required)
- send_slack(message, channel?) — post to Slack channel

— Research & Data —
- search_web(query) — search the web for material prices, code requirements, supplier info, subcontractor rates, permit fees, news
- get_weather(location) — current weather + 24hr forecast + construction risk assessment for any city or zip code
- search_materials(query) — web search focused on DFW material pricing and suppliers

— Files & Storage —
- list_drive_files(folder?) — list Google Drive files
- list_onedrive_files() — list Microsoft OneDrive files

— Finance —
- get_invoices(top?) — list QuickBooks invoices
- get_expenses(top?) — list QuickBooks expenses

— Automation —
- trigger_zapier(event, data) — trigger a Zapier automation with custom data

ALWAYS call search_web() when asked about prices, suppliers, code requirements, permit info, or anything that needs current real-world data — do NOT guess at current prices.
ALWAYS call get_weather() when asked about job site conditions, scheduling around weather, or anything weather-related.

ALWAYS return valid JSON:
{
  "message": "Your response to the user",
  "tool_calls": [{ "tool": "tool_name", "args": { ... } }],
  "suggestions": ["What to do next?"]
}

PRICING: DFW TX metro, 2025-2026 market rates.
NEVER invent project data — only use what is provided in context.
ALWAYS return valid JSON. No prose before or after the JSON.`;

// GPT-4o acts as an independent expert — different lens, not a polisher
const SYSTEM_GPT_ANALYST = `You are a senior construction estimator and project manager in the Dallas–Fort Worth metro, at a different firm than the user. You are reviewing the same question they asked their primary AI assistant.

Your job:
1. Provide your independent expert perspective on their question
2. Identify any risks, gaps, or angles the primary analysis might miss
3. Suggest alternative approaches where relevant
4. Flag any DFW-specific considerations (labor rates, code, suppliers, permitting timelines)

Be direct, specific, and concise. Under 250 words. Plain prose — no JSON, no bullet overkill.`;

// Synthesis system: Claude acts as orchestrator of both its own + GPT's output
const SYSTEM_SYNTHESIZER = `You are the Onyx Intel AI orchestrator. You have just received two independent expert analyses of the user's construction question:
1. Your own initial reasoning (primary AI — Claude)
2. An independent analysis from GPT-4o (secondary expert)

Your job is to synthesize these into the single best response by:
- Incorporating the strongest insights from both
- Resolving any contradictions (favor the more conservative, safe, or code-compliant construction answer)
- Filling gaps one analysis missed that the other caught
- Keeping the response specific and actionable for a DFW construction project

ALWAYS return valid JSON — no prose before or after:
{
  "message": "Synthesized expert response",
  "tool_calls": [],
  "suggestions": ["Next step?"]
}`;

// ── Agent runner ─────────────────────────────────────────────────
export async function runAgent(cfgPrimary, messages, projectContext, cfgSecondary, agentType = "preconstruction") {
  if (!cfgPrimary) throw new Error("No AI provider configured. Add your API key in Integrations (⚙).");

  const companyCtx = getCompanyContext();
  const contextBlock = buildContextBlock(projectContext, companyCtx);

  // Load specialist agent system prompt — fall back to legacy SYSTEM_CLAUDE for unknown types
  const agentDef = getAgent(agentType);
  const systemClaude = (agentDef?.system || SYSTEM_CLAUDE) + "\n\n" + contextBlock;
  const systemGpt = SYSTEM_GPT_ANALYST + "\n\n" + contextBlock;

  // ── Stage 1: Parallel independent reasoning ──────────────────
  // Both models analyze the question simultaneously — no one waits on the other
  const [claudeRaw, gptAnalysis] = await Promise.all([
    chatText(cfgPrimary, systemClaude, messages),
    cfgSecondary
      ? chatText(cfgSecondary, systemGpt, messages).catch(() => null)
      : Promise.resolve(null),
  ]);

  const claudeResult = parseAgentResponse(claudeRaw);

  // If no secondary provider or it failed, return primary result as-is
  if (!cfgSecondary || !gptAnalysis) return claudeResult;

  // ── Stage 2: Claude synthesizes both perspectives ─────────────
  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const synthesisInput = [
    {
      role: "user",
      content: `User asked: "${lastUserMsg}"

CLAUDE'S INITIAL ANALYSIS:
${claudeResult.message}

GPT-4o'S INDEPENDENT EXPERT ANALYSIS:
${gptAnalysis}

Synthesize the strongest final response. Preserve these tool_calls from the initial analysis (do not drop them unless they are clearly wrong):
${JSON.stringify(claudeResult.tool_calls || [])}`,
    },
  ];

  const synthRaw = await chatText(cfgPrimary, SYSTEM_SYNTHESIZER, synthesisInput);
  const result = parseAgentResponse(synthRaw);

  // Safeguard: if synthesis dropped valid tool_calls, restore them
  if ((!result.tool_calls || !result.tool_calls.length) && claudeResult.tool_calls?.length) {
    result.tool_calls = claudeResult.tool_calls;
  }

  result._dual = true;
  result._stages = { claude: claudeResult.message, gpt: gptAnalysis };

  return result;
}

// ── Context builder ──────────────────────────────────────────────
function buildContextBlock(project, company) {
  let block = "";

  if (company) {
    block += `COMPANY: ${company.name || "Onyx & Iron Construction"}\n`;
    if (company.tagline) block += `Tagline: ${company.tagline}\n`;
    if (company.services) block += `Services: ${company.services}\n`;
    if (company.serviceArea) block += `Service Area: ${company.serviceArea}\n`;
    if (company.phone) block += `Phone: ${company.phone}\n`;
    if (company.email) block += `Email: ${company.email}\n`;
    if (company.summary) block += `About: ${company.summary.slice(0, 400)}\n`;
    block += "\n";
  }

  if (project) {
    // Pull full rich context from project store
    const ctx = getProjectContext(project.id) || project;

    block += `ACTIVE PROJECT:
Name: ${ctx.name}
Address: ${ctx.address || "—"}
Client: ${ctx.client || "—"}
Type: ${ctx.projectType || "—"}
Status: ${ctx.status || "—"}
Budget: $${(ctx.budget || 0).toLocaleString()}
Plans loaded: ${(ctx.planIds || []).length}
Contacts: ${(ctx.contacts || []).map(c => `${c.name}${c.company ? " (" + c.company + ")" : ""}`).join(", ") || "None"}
`;
    if (ctx.description) block += `Description: ${ctx.description.slice(0, 300)}\n`;
    if (ctx.notes) block += `Notes: ${ctx.notes.slice(0, 300)}\n`;

    // Document summaries — tell the agent what sheets exist
    const docSummaries = ctx.documentSummaries || {};
    const summaryEntries = Object.values(docSummaries);
    if (summaryEntries.length > 0) {
      block += `\nDOCUMENT LIBRARY (${summaryEntries.length} document${summaryEntries.length > 1 ? "s" : ""}):\n`;
      for (const s of summaryEntries) {
        block += `• ${s.fileName} — ${s.pageCount} pages`;
        if (s.disciplines?.length) block += `, disciplines: ${s.disciplines.join(", ")}`;
        if (s.sheets?.length) block += `\n  Sheets: ${s.sheets.slice(0, 20).join(", ")}${s.sheets.length > 20 ? ` (+${s.sheets.length - 20} more)` : ""}`;
        block += "\n";
      }
    }

    // Open tasks
    const tasks = (ctx.tasks || []).filter(t => !t.done).slice(0, 8);
    if (tasks.length > 0) {
      block += `\nOPEN TASKS:\n`;
      for (const t of tasks) block += `• [${t.priority || "normal"}] ${t.title}${t.due ? ` (due ${t.due})` : ""}\n`;
    }

    // Knowledge base — accumulated facts from prior analysis
    const facts = (ctx.knowledgeBase || []).slice(0, 20);
    if (facts.length > 0) {
      block += `\nACCUMULATED PROJECT KNOWLEDGE (from prior document analysis):\n`;
      for (const f of facts) block += `• ${f.text}\n`;
    }

    // Recent Q&A history — so the agent can build on prior work
    const recentQna = (ctx.recentQna || []).slice(0, 5);
    if (recentQna.length > 0) {
      block += `\nRECENT Q&A HISTORY (reference and build on these — do not repeat, extend):\n`;
      for (const e of recentQna) {
        block += `[${e.ts?.slice(0, 10) || "recent"}] Q: ${e.question}\n`;
        block += `A: ${(e.answer || "").slice(0, 400)}${(e.answer || "").length > 400 ? "…" : ""}\n---\n`;
      }
    }

    // Prior takeoff reports
    const takeoffReports = (ctx.takeoffReports || []).slice(0, 2);
    if (takeoffReports.length > 0) {
      block += `\nPRIOR TAKEOFF REPORTS:\n`;
      for (const r of takeoffReports) {
        block += `• ${r.docName || "Plan"} pg ${r.page}${r.sheet ? ` (${r.sheet})` : ""} — ${r.itemCount} items — ${r.createdAt?.slice(0, 10)}\n`;
        if (r.analysis) block += `  ${r.analysis.slice(0, 300)}\n`;
      }
    }
  } else {
    block += "No project currently selected.\n";
  }

  return block;
}

function parseAgentResponse(raw) {
  try { return repairJSON(raw); } catch {}
  return { message: raw.replace(/```json[\s\S]*?```/gi, "").trim(), tool_calls: [], suggestions: [] };
}
