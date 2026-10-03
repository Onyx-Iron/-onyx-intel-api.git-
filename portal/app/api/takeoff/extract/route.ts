import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildGroundedSystemPrompt } from "@/lib/ai/grounding";
import { headerSafe } from "@/lib/http";
import { pythonApiBaseUrl, pythonApiHeaders } from "@/lib/python-api";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

const PYTHON_API_URL = pythonApiBaseUrl();

// ── AI vision provider config (used only when ?ai_fallback=true) ─────────────
const GEMINI_API_KEY    = headerSafe(process.env.GEMINI_API_KEY);
const GEMINI_MODEL      = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
const ANTHROPIC_API_KEY = headerSafe(process.env.ANTHROPIC_API_KEY);
const ANTHROPIC_MODEL   = process.env.TAKEOFF_AI_MODEL ?? "claude-sonnet-4-6";

export const runtime = "nodejs";
export const maxDuration = 300; // CAD/IFC parsing + AI vision can both take time

/**
 * Unified takeoff extraction entry point.
 *
 * Modes (selected via query string):
 *   - default:            multipart upload → Python /api/takeoff/extract (deterministic, JSON response)
 *   - ?stream=true:       multipart upload → Python /api/stream/upload    (NDJSON streaming response)
 *   - ?ai_fallback=true:  multipart PDF    → Gemini/Anthropic vision      (JSON rows, paid path)
 *
 * Tenant isolation is enforced on every path: X-Onyx-Tenant uses the Clerk
 * org id (or `user_<userId>` for personal workspaces).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantKey  = orgId ?? `user_${userId}`;
    const projectId  = req.nextUrl.searchParams.get("project_id") ?? "";
    const aiFallback = req.nextUrl.searchParams.get("ai_fallback") === "true";
    const streaming  = req.nextUrl.searchParams.get("stream") === "true";

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    if (projectId) {
      try {
        await assertProjectBelongsToTenant(projectId, tenantId);
      } catch (err) {
        const owned = ownershipDenied(err);
        if (owned) return owned;
        throw err;
      }
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    if (aiFallback) {
      return await runAiFallback(req, tenantKey, email);
    }

    if (streaming) {
      return await runStreamingExtract(req, tenantKey, projectId, email);
    }

    return await runDeterministicExtract(req, tenantKey, projectId, email);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[takeoff/extract] ${msg}` }, { status: 500 });
  }
}

// ── Default: deterministic single-shot extract ───────────────────────────────
async function runDeterministicExtract(req: NextRequest, tenantKey: string, projectId: string, email: string | null): Promise<NextResponse> {
  const formData = await req.formData();

  const upstream = await fetch(`${PYTHON_API_URL}/api/takeoff/extract`, {
    method: "POST",
    headers: pythonApiHeaders({ email, tenantId: tenantKey, projectId }),
    body: formData,
    // @ts-expect-error — Node fetch supports duplex for streaming bodies
    duplex: "half",
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    let detail = text;
    try { detail = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* keep raw */ }
    return NextResponse.json({ error: detail }, { status: upstream.status });
  }

  return NextResponse.json(JSON.parse(text));
}

// ── Streaming: NDJSON passthrough for large JSON takeoff uploads ─────────────
async function runStreamingExtract(req: NextRequest, tenantKey: string, projectId: string, email: string | null): Promise<Response> {
  const formData = await req.formData();

  const upstreamUrl = new URL(`${PYTHON_API_URL}/api/stream/upload`);
  const chunkSize = req.nextUrl.searchParams.get("chunk_size");
  if (chunkSize) upstreamUrl.searchParams.set("chunk_size", chunkSize);

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: "POST",
    headers: pythonApiHeaders({ email, tenantId: tenantKey, projectId }),
    body: formData,
    // @ts-expect-error — Node 18 fetch supports duplex for streaming
    duplex: "half",
  });

  if (!upstreamRes.ok) {
    const detail = await upstreamRes.text().catch(() => "upstream error");
    return NextResponse.json(
      { error: `[takeoff/extract stream] upstream ${upstreamRes.status}: ${detail}` },
      { status: 502 },
    );
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type":      "application/x-ndjson",
      "Cache-Control":     "no-cache, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── AI vision fallback (Gemini default, Anthropic alternative) ───────────────

interface TakeoffRow {
  trade: string;
  cost_code: string;
  description: string;
  quantity_basis: string;
  total_qty: number;
  uom: string;
  drawing_ref?: string | null;
  location_tag?: string | null;
}

const SYSTEM_PROMPT =
  "You are a senior construction estimator performing a quantity takeoff from drawings. " +
  "Extract every measurable item you can identify into CSI MasterFormat line items. " +
  "Rules: (1) Use real CSI codes formatted NN-NN-NN. (2) Only report quantities you can " +
  "actually justify from what is visible — counts of fixtures/devices, scheduled equipment, " +
  "or runs you can measure against a stated scale or dimension. (3) For every row, the " +
  "quantity_basis must state exactly how you got the number (e.g. 'Counted 14 type-A " +
  "luminaires on sheet E-201', 'Scaled 220 LF of 4-inch sanitary at 1/8\"=1ft'). " +
  "(4) Never invent quantities you cannot see — omit rather than guess. " +
  "(5) Prefer EA for counts, LF for runs, SF/SY for areas, CY for volumes.\n\n" +
  "CIVIL GRADING PLANS: if the sheet shows spot elevations, contour lines, or grading " +
  "callouts (EX/EXIST = existing grade, PROP/FG = proposed/finish grade, TC/FL = top/flow " +
  "line, TW/BW = top/bottom of wall), extract earthwork as SEPARATE line items by scope — " +
  "do not lump everything into one generic 'earthwork' row: " +
  "  - 31-11-00 Clearing & Grubbing (site vegetation removal, AC) " +
  "  - 31-14-13 Topsoil Strip & Stockpile (strip depth if noted, else assume 6in over the " +
  "    graded limits, CY) " +
  "  - 31-23-16 Mass Excavation / Cut-Fill (net cut or fill volume — read every existing " +
  "    and proposed spot elevation visible on the sheet, weight each by the area it " +
  "    represents rather than a flat average of a few points, and state in quantity_basis " +
  "    exactly which elevations and areas you used, e.g. 'Existing 617-628ft, proposed " +
  "    620-625ft across ~X SF graded limit, area-weighted net cut ~Y ft'; CY) " +
  "  - 31-23-23 Building Pad / Subgrade Preparation (ONLY if a geotechnical note specifies " +
  "    recompaction/scarification depth and offset beyond the building footprint — quantify " +
  "    as footprint-plus-offset area times the specified depth, CY) " +
  "  - 31-25-00 Erosion Control (silt fence/slope protection LF or SF, if shown) " +
  "  - 32-32-00 Retaining Walls (LF, using TW/BW elevation pairs where shown) " +
  "Flag drawing_ref with the sheet number and location_tag with the zone/area described. " +
  "If the sheet references a geotechnical report for specs (a common note: 'per geotechnical " +
  "report') but the actual depth/offset values aren't visible on this sheet, omit the " +
  "31-23-23 row rather than guessing a depth — the estimator should cross-reference the " +
  "geotech report separately via the document Q&A tool.";

const ROW_PROPERTIES = {
  trade:          "string",
  cost_code:      "string",
  description:    "string",
  quantity_basis: "string",
  total_qty:      "number",
  uom:            "string",
  drawing_ref:    "string",
  location_tag:   "string",
} as const;
const REQUIRED = ["trade", "cost_code", "description", "quantity_basis", "total_qty", "uom"];

function geminiSchema() {
  const props: Record<string, { type: string }> = {};
  for (const [k, t] of Object.entries(ROW_PROPERTIES)) props[k] = { type: t.toUpperCase() };
  return {
    type: "ARRAY",
    items: { type: "OBJECT", properties: props, required: REQUIRED },
  };
}

function anthropicTool() {
  const props: Record<string, { type: string }> = {};
  for (const [k, t] of Object.entries(ROW_PROPERTIES)) props[k] = { type: t };
  return {
    name: "emit_takeoff_rows",
    description: "Return the structured CSI-coded takeoff line items extracted from the drawings.",
    input_schema: {
      type: "object",
      properties: { rows: { type: "array", items: { type: "object", properties: props, required: REQUIRED } } },
      required: ["rows"],
    },
  };
}

function normalize(rows: TakeoffRow[]): TakeoffRow[] {
  return (rows ?? [])
    .filter((r) => r && r.description && typeof r.total_qty === "number")
    .map((r) => ({
      trade:          String(r.trade ?? "General"),
      cost_code:      String(r.cost_code ?? "01-00-00"),
      description:    String(r.description).slice(0, 300),
      quantity_basis: String(r.quantity_basis ?? "AI vision extraction").slice(0, 250),
      total_qty:      Number(r.total_qty),
      uom:            String(r.uom ?? "EA").toUpperCase().slice(0, 8),
      drawing_ref:    r.drawing_ref ? String(r.drawing_ref) : null,
      location_tag:   r.location_tag ? String(r.location_tag) : null,
    }));
}

async function callGemini(base64: string, userText: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildGroundedSystemPrompt(SYSTEM_PROMPT, { requireCitations: true, sourceLabel: "attached drawing PDF" }) }] },
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: "application/pdf", data: base64 } },
            { text: userText },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: geminiSchema(),
          temperature: 0,
          maxOutputTokens: 16384,
        },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`[gemini ${res.status}] ${detail.slice(0, 500)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
  let rows: TakeoffRow[] = [];
  try { rows = JSON.parse(text); } catch { rows = []; }
  return { rows, model: GEMINI_MODEL, usage: data.usageMetadata ?? null };
}

async function callAnthropic(base64: string, userText: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: buildGroundedSystemPrompt(SYSTEM_PROMPT, { requireCitations: true, sourceLabel: "attached drawing PDF" }),
      tools: [anthropicTool()],
      tool_choice: { type: "tool", name: "emit_takeoff_rows" },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: userText },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`[anthropic ${res.status}] ${detail.slice(0, 500)}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; name?: string; input?: { rows?: TakeoffRow[] } }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "emit_takeoff_rows");
  return { rows: toolUse?.input?.rows ?? [], model: ANTHROPIC_MODEL, usage: data.usage ?? null };
}

async function runAiFallback(req: NextRequest, tenantKey: string, email: string | null): Promise<NextResponse> {
  try {
    const provider = GEMINI_API_KEY ? "gemini" : ANTHROPIC_API_KEY ? "anthropic" : null;
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "AI takeoff is not configured. Add a GEMINI_API_KEY (or ANTHROPIC_API_KEY) " +
            "environment variable in Vercel to enable the vision fallback.",
          code: "NO_API_KEY",
        },
        { status: 503 },
      );
    }

    // Full-document vision extraction is the most expensive call in this app
    // (whole PDF, up to 32MB, sent per request) — throttle harder than the
    // deterministic (non-AI) extraction path above.
    const rl = await checkAiRateLimit(tenantKey, "takeoff/extract:ai_fallback", { windowMs: 60_000, max: 5 }, email);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many AI takeoff extraction requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "AI extraction accepts PDF only" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > 32 * 1024 * 1024) {
      return NextResponse.json(
        { error: "PDF exceeds the 32 MB limit. Split the drawing set and retry." },
        { status: 413 },
      );
    }
    const base64 = bytes.toString("base64");

    const pagesHint = req.nextUrl.searchParams.get("pages");
    const userText = pagesHint
      ? `Perform a quantity takeoff. Focus on these graphical drawing pages the table parser could not read: ${pagesHint}. Extract all measurable CSI line items.`
      : "Perform a complete quantity takeoff of this drawing set. Extract all measurable CSI line items.";

    const result = provider === "gemini"
      ? await callGemini(base64, userText)
      : await callAnthropic(base64, userText);

    const normalized = normalize(result.rows);
    return NextResponse.json({
      source_type: "ai_vision",
      provider,
      model: result.model,
      rows: normalized,
      coverage: { rows_extracted: normalized.length },
      usage: result.usage,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[takeoff/extract ai_fallback] ${msg}` }, { status: 502 });
  }
}
