import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { headerSafe } from "@/lib/http";
import { runScopeGapAgent } from "@/lib/agents/scope-gap";
import { runRfiDrafterAgent } from "@/lib/agents/rfi-drafter";

export const runtime = "nodejs";
export const maxDuration = 90;

const PLANS_BUCKET     = "plans-bucket";
const GEMINI_API_KEY   = headerSafe(process.env.GEMINI_API_KEY);
const GEMINI_MODEL     = process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
const GEMINI_BASE      = "https://generativelanguage.googleapis.com/v1beta";

/**
 * POST /api/takeoff/canvas/vision-extract { page_id, force? }
 *
 * Runs Gemini vision over the single-page PDF and returns structured takeoff
 * candidates pulled from raster images, schedule tables, notes, callouts,
 * dimensions — anything the pdfjs vector walk missed.
 *
 * Idempotent: cached in document_pages.vision_extractions. Pass force=true
 * to re-run.
 *
 * GET /api/takeoff/canvas/vision-extract?page_id=  → returns cached result only.
 */

interface VisionItem {
  description: string;
  quantity: number;
  unit: string;              // LF / SF / EA / CY / TON etc.
  cost_code?: string;        // NN-NN-NN if visible
  layer_hint?: string;       // heuristic ("C-SSWR", "SANITARY")
  source: "schedule" | "note" | "callout" | "image" | "text";
  confidence: number;        // 0..1
  raw_text?: string;         // the substring the model quoted
}

interface VisionResult {
  items: VisionItem[];
  page_summary: string;
  extracted_at: string;
  model: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("document_pages")
    .select("vision_extractions, vision_extracted_at")
    .eq("id", pageId).eq("tenant_id", tenantId)
    .maybeSingle();
  return NextResponse.json({
    result: (data?.vision_extractions ?? null) as VisionResult | null,
    extracted_at: data?.vision_extracted_at ?? null,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!GEMINI_API_KEY) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({})) as { page_id?: string; force?: boolean };
  if (!body.page_id) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data: page } = await anyDb
    .from("document_pages")
    .select("id, storage_path, page_number, vision_extractions")
    .eq("id", body.page_id).eq("tenant_id", tenantId).single();
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  if (page.vision_extractions && !body.force) {
    return NextResponse.json({ result: page.vision_extractions as VisionResult, cached: true });
  }

  // Download page PDF bytes
  const dl = await db.storage.from(PLANS_BUCKET).download(page.storage_path);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: `Storage download failed: ${dl.error?.message ?? "empty"}` }, { status: 502 });
  }
  const bytes = new Uint8Array(await dl.data.arrayBuffer());

  // Chunk-safe base64 encode
  const base64 = bufferToBase64(bytes);

  // Ask Gemini to return strict JSON matching our schema.
  const geminiBody = {
    contents: [{
      role: "user",
      parts: [
        {
          text: [
            "You are a construction estimator reading a single construction drawing page.",
            "Extract EVERY takeoff-relevant quantity you can see from:",
            "  1. Schedule tables (door, window, fixture, equipment, material schedules)",
            "  2. Notes and general notes",
            "  3. Leader callouts (e.g. \"8\" SANITARY, 240 LF\")",
            "  4. Bill of materials or key legends",
            "  5. Raster images / photo insets showing tagged items",
            "  6. Dimension strings that imply lengths, widths, areas",
            "",
            "Return STRICT JSON matching this schema (no prose, no markdown fences):",
            "{",
            "  \"page_summary\": \"one-sentence description of what this sheet shows\",",
            "  \"items\": [",
            "    {",
            "      \"description\": \"...\",",
            "      \"quantity\": number,",
            "      \"unit\": \"LF|SF|EA|CY|TON|GAL|LB\",",
            "      \"cost_code\": \"NN-NN-NN or null\",",
            "      \"layer_hint\": \"C-SSWR|A-DOOR|... optional\",",
            "      \"source\": \"schedule|note|callout|image|text\",",
            "      \"confidence\": 0.0..1.0,",
            "      \"raw_text\": \"the exact substring you read\"",
            "    }",
            "  ]",
            "}",
            "",
            "Rules:",
            " - Skip anything you can't quantify.",
            " - If a schedule shows counts of doors/windows/fixtures, emit one item PER TYPE with quantity=count.",
            " - Use CSI MasterFormat cost_code when you can infer it.",
            " - confidence < 0.5 for guesses; > 0.85 only when the label AND number are unambiguous.",
            " - Do not invent items. If the sheet is a title block only, return items: []."
          ].join("\n"),
        },
        { inlineData: { mimeType: "application/pdf", data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify(geminiBody),
    },
  );
  if (!res.ok) {
    const errText = (await res.text().catch(() => "")).slice(0, 500);
    return NextResponse.json({ error: `Gemini ${res.status}: ${errText}` }, { status: 502 });
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();

  let parsed: { page_summary?: string; items?: VisionItem[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Gemini returned non-JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }
  const items: VisionItem[] = Array.isArray(parsed.items) ? parsed.items.slice(0, 500).map((it) => ({
    description: String(it.description ?? "").slice(0, 400),
    quantity: safeNumber(it.quantity, 0),
    unit: String(it.unit ?? "EA").toUpperCase().slice(0, 12),
    cost_code: typeof it.cost_code === "string" && /^\d{2}-\d{2}-\d{2}$/.test(it.cost_code) ? it.cost_code : undefined,
    layer_hint: typeof it.layer_hint === "string" ? it.layer_hint.slice(0, 60) : undefined,
    source: (["schedule", "note", "callout", "image", "text"].includes(String(it.source)) ? it.source : "text") as VisionItem["source"],
    confidence: safeNumber(it.confidence, 0.5, 0, 1),
    raw_text: typeof it.raw_text === "string" ? it.raw_text.slice(0, 400) : undefined,
  })) : [];

  const result: VisionResult = {
    items,
    page_summary: String(parsed.page_summary ?? "").slice(0, 400),
    extracted_at: new Date().toISOString(),
    model: GEMINI_MODEL,
  };

  await anyDb
    .from("document_pages")
    .update({ vision_extractions: result, vision_extracted_at: result.extracted_at })
    .eq("id", body.page_id).eq("tenant_id", tenantId);

  // ── Background agents (fire-and-forget) ──────────────────────────────────
  // Agents ONLY write to `ai_agent_audit_trails` with status
  // 'pending_human_review'. They cannot mutate estimates, send RFIs, or push
  // purchasing metrics until the human clicks Approve.
  void runBackgroundAgents({
    db: anyDb,
    tenantId,
    projectId: null,
    pageId: page.id,
    documentId: (page as { document_id?: string }).document_id ?? null,
    pageNumber: (page as { page_number?: number }).page_number ?? 1,
    visionItems: items,
  }).catch((e) => console.error("[agents]", e));

  return NextResponse.json({ result, cached: false });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runBackgroundAgents(args: { db: any; tenantId: string; projectId: string | null; pageId: string; documentId: string | null; pageNumber: number; visionItems: any[] }): Promise<void> {
  const { db, tenantId, pageId, pageNumber, visionItems } = args;
  let projectId = args.projectId;
  let documentName: string | null = null;

  // Resolve project via document_id (page → document → project)
  if (args.documentId) {
    const { data: doc } = await db.from("documents")
      .select("project_id, file_name")
      .eq("id", args.documentId).eq("tenant_id", tenantId).maybeSingle();
    projectId = (doc as { project_id?: string })?.project_id ?? projectId;
    documentName = (doc as { file_name?: string })?.file_name ?? null;
  }
  if (!projectId) return;

  await Promise.allSettled([
    runScopeGapAgent({
      db, tenantId, projectId, pageId,
      documentId: args.documentId,
      visionItems,
    }),
    runRfiDrafterAgent({
      db, tenantId, projectId, pageId, pageNumber,
      documentId: args.documentId,
      documentName,
      visionItems,
    }),
  ]);
}

function safeNumber(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (typeof min === "number" && n < min) return min;
  if (typeof max === "number" && n > max) return max;
  return n;
}

function bufferToBase64(bytes: Uint8Array): string {
  // Chunk to avoid stack overflow on large PDFs.
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return Buffer.from(out, "binary").toString("base64");
}
