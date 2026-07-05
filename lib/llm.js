import { getConfig, saveDocParsed } from "./store.js";
import { visionRead, chatJSON, chatText, ping, providerList, repairJSON } from "./providers.js";

export function aiStatus() {
  const cfg = getConfig();
  return {
    configured: !!(cfg && cfg.provider && cfg.apiKey),
    provider: cfg?.provider || null,
    model: cfg?.model || null,
    providers: providerList(),
  };
}
export function hasKey() { const cfg = getConfig(); return !!(cfg && cfg.provider && cfg.apiKey); }

export async function testConnection(cfg) { return ping(cfg); }

export async function readSheetImage(pngBase64) {
  const cfg = getConfig();
  if (!cfg) return null;
  const prompt = `You are reading a construction plan sheet. Transcribe ALL visible text exactly as printed: titleblock info (sheet number, title, date, project, drawn by), all notes, dimensions, schedules, callouts, abbreviations, and legend text. Preserve numbers and codes exactly. If text is illegible, write [illegible]. Do not guess or invent content.`;
  return visionRead(cfg, pngBase64, prompt);
}

export async function answerQuestion(question, contextPages) {
  const cfg = getConfig();
  if (!cfg) return { found: false, answer: "No AI provider configured. Add a key in ⚙ Settings.", citations: [] };

  const system = `You are an AI assistant for a construction company. Answer questions ONLY from the provided plan pages. NEVER invent, guess, or assume information not present in the text. If the answer is not in the provided pages, say so clearly.

Return valid JSON exactly like this (no text before or after):
{"found":true,"answer":"Your detailed answer here","citations":[{"document":"filename","page":5,"sheet":"A-101"}]}

OR if not found:
{"found":false,"answer":"I could not find information about X in the provided pages.","citations":[]}

Cite every page you drew information from.`;

  const pageText = contextPages.map(p =>
    `--- ${p.documentName} | Page ${p.page}${p.sheet ? ` | Sheet ${p.sheet}` : ""} ---\n${p.text}`
  ).join("\n\n");
  const user = `Pages:\n${pageText}\n\nQuestion: ${question}`;

  try {
    // Use chatText so we always get raw output — never silently truncate inside a JSON string
    const raw = await chatText(cfg, system, [{ role: "user", content: user }], { maxTokens: 8000 });

    // Try structured parse first
    try {
      const parsed = repairJSON(raw);
      if (parsed && typeof parsed.found !== "undefined") return parsed;
    } catch { /* fall through */ }

    // Fallback: return raw text as answer (still useful to the user)
    const cleaned = raw.replace(/```json[\s\S]*?```/gi, "").replace(/```[\s\S]*?```/gi, "").trim();
    return { found: true, answer: cleaned, citations: [] };
  } catch (e) {
    return { found: false, answer: `Error: ${e.message}`, citations: [] };
  }
}

export async function answerTakeoffQuestion(question, contextPages) {
  const cfg = getConfig();
  if (!cfg) return { found: false, answer: "No AI provider configured. Add a key in ⚙ Settings.", citations: [] };

  const system = `You are a senior construction estimator for a Dallas-Fort Worth project. Produce a COMPLETE QUANTITY TAKEOFF from ALL provided plan pages.

OUTPUT FORMAT — follow this exactly, no markdown, no prose:

Line 1 must be the header row (copy verbatim):
Division|CSI Code|Description|Location|Qty|Unit|Drawing Ref|Notes / Assumptions

For each CSI division that has items, output a division header row with empty remaining columns:
DIV 01 — General Requirements (N items)|||||||

Then one data row per line item, pipe-delimited, 8 columns:
DIV 01|01 10 00|General Conditions — Mobilization / Demobilization|Both Buildings|1|LS|A-001|Duration per contract schedule

COLUMN RULES:
- Division: always "DIV XX" with 2-digit number (DIV 01, DIV 02, DIV 03, DIV 06, DIV 07, DIV 08, DIV 09, DIV 10, DIV 11, DIV 13, DIV 15, DIV 22, DIV 26, DIV 31, DIV 32, DIV 33)
- CSI Code: 6-digit CSI MasterFormat code (e.g. 03 30 00, 07 31 13, 22 11 16)
- Description: full material description with spec (model numbers, dimensions, ratings, finishes)
- Location: specific building ("Building 1", "Building 2"), "Both Buildings", or "Site"
- Qty: number only, no commas, no units
- Unit: LS, SF, LF, CY, EA, SET, BLDG, EA/UNIT, CKT, STALL — standard CSI units
- Drawing Ref: sheet numbers from plans (e.g. "S2.01", "A-801, A-202", "M4.01")
- Notes / Assumptions: show the calculation math and cite plan pages (e.g. "9 units × 3 baths = 27; per P3.00 fixture schedule"); flag with "(field verify)" if uncertain

ESTIMATING RULES:
- Extract EVERY quantity visible across ALL pages — never omit or say "cannot be completed"
- When an item repeats per building, output a separate row per building
- Pull ALL specs: PSI ratings, gauges, model numbers, manufacturer names, dimensions, finish types
- Show your math in the Notes column; include page references
- Use exact printed dimensions when visible
- Skip divisions only if truly nothing appears — do not pad with guesses
- Do NOT output any text outside the pipe-delimited table (no preamble, no summary prose)`;


  const pageText = contextPages.map(p =>
    `--- ${p.documentName} | Pg ${p.page}${p.sheet ? ` | Sheet ${p.sheet}` : ""}${p.calibrated ? " [★ CALIBRATED]" : ""}${p.isDrawing ? " [DRAWING]" : " [SPEC]"} ---\n${p.text || "(image-based — extract all visible dimensions, labels, callouts)"}`
  ).join("\n\n");

  const user = `PLAN PAGES (${contextPages.length} pages loaded):\n\n${pageText}\n\n---\nRequest: ${question}`;

  try {
    // Use chatText (not chatJSON) — takeoff responses are long markdown, not JSON;
    // JSON parsing on a multi-thousand-token takeoff always risks truncation errors.
    // 16k tokens gives room for comprehensive multi-division takeoffs.
    const text = await chatText(cfg, system, [{ role: "user", content: user }], { maxTokens: 16000 });

    // Extract page citations from inline references like "(pg 27)" or "Page 60"
    const citationMatches = [...text.matchAll(/(?:pg|page)\s*(\d+)/gi)];
    const seenPages = new Set();
    const citations = [];
    for (const m of citationMatches) {
      const pg = parseInt(m[1], 10);
      if (!seenPages.has(pg)) {
        seenPages.add(pg);
        const ctx = contextPages.find(p => p.page === pg);
        if (ctx) citations.push({ document: ctx.documentName, page: pg, sheet: ctx.sheet || null, documentId: ctx.documentId });
      }
    }

    return { found: true, answer: text, citations };
  } catch (e) {
    return { found: false, answer: `Error: ${e.message}`, citations: [] };
  }
}

// ── One-time document intelligence extraction ─────────────────────
// Runs after ingestion. Extracts structured data (sheets, rooms, materials,
// quantities, specs) into data/parsed/{docId}.json so future Q&A and takeoff
// calls can read the cache instead of re-sending all raw page text to the AI.
export async function extractDocumentIntelligence(docId, pages) {
  const cfg = getConfig();
  if (!cfg) return;

  const meaningful = pages.filter(p => (p.text || "").trim().length > 50);
  if (!meaningful.length) return;

  // Sort by content richness; cap at 40 pages to stay within context limits
  const selected = [...meaningful]
    .sort((a, b) => (b.text || "").length - (a.text || "").length)
    .slice(0, 40);

  const system = `You are a construction document analyst. Extract ALL structured data visible across these plan pages into a single JSON object. This is a ONE-TIME extraction — be thorough because it will be cached and reused for every future question about this document. Return ONLY valid JSON, no markdown fences.`;

  const pageText = selected.map(p =>
    `--- Page ${p.page}${p.sheet ? ` (${p.sheet})` : ""} ---\n${(p.text || "").slice(0, 900)}`
  ).join("\n\n");

  const prompt = `Extract every piece of useful construction data from these plan pages. Return ONLY this JSON structure (fill every array you can find data for):
{
  "projectName": "",
  "address": "",
  "owner": "",
  "architect": "",
  "engineer": "",
  "contractNumber": "",
  "date": "",
  "revision": "",
  "sheets": [{"number":"","title":"","page":0,"scale":""}],
  "rooms": [{"name":"","area":"","page":0}],
  "dimensions": [],
  "materials": [],
  "equipment": [],
  "specifications": [],
  "quantities": [{"item":"","qty":"","unit":"","page":0}],
  "notes": [],
  "contacts": [{"name":"","company":"","role":"","phone":"","email":""}]
}

Plan pages:
${pageText}`;

  try {
    const raw = await chatText(cfg, system, [{ role: "user", content: prompt }], { maxTokens: 6000 });
    let intel = null;
    try { intel = repairJSON(raw); } catch { return; }
    if (!intel) return;

    saveDocParsed(docId, {
      ...intel,
      docId,
      pageCount: pages.length,
      extractedAt: new Date().toISOString(),
    });
    console.log(`[cache] Intelligence extracted and saved for doc ${docId}`);
  } catch (e) {
    console.warn(`[cache] Intelligence extraction failed for ${docId}:`, e.message);
  }
}
