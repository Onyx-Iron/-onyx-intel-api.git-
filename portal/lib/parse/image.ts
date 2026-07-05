/**
 * Image parser — sends the image to Gemini with a construction-doc prompt
 * and returns extracted entities (sheet numbers, dimensions, materials,
 * vendors, line items, etc., biased by the optional hint).
 */
import type { ParseResult, ParseContext, ParseEntity } from "./index";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? "gemini-2.0-flash-001";

const HINT_FOCUS: Record<string, string> = {
  takeoff:   "quantities, materials, dimensions, areas, CSI codes, sheet numbers",
  estimate:  "line items, unit prices, quantities, totals, vendors",
  vendors:   "company names, contacts, phone numbers, emails, addresses, trades",
  invoices:  "invoice number, vendor, line items, amounts, totals, dates, terms",
  punch:     "punch items, locations, trades, status, dates",
  contacts:  "person names, roles, companies, phones, emails",
  docs:      "sheet numbers, spec sections, RFI/submittal IDs, dates, titles",
};

function mimeFor(filename: string, fallback: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  return fallback || "application/octet-stream";
}

export async function parseImage(
  bytes: Buffer,
  base: { filename: string; mime: string },
  ctx: ParseContext,
): Promise<ParseResult> {
  if (!GEMINI_API_KEY) {
    return { kind: "error", ...base, error: "GEMINI_API_KEY not configured" };
  }

  const mime = mimeFor(base.filename, base.mime);
  const focus = ctx.hint ? HINT_FOCUS[ctx.hint] ?? "" : "";

  const prompt = `You are analyzing a construction/engineering document image.
Extract structured entities. Return ONLY a JSON object — no markdown — shaped:
{ "entities": [ { "type": "<short label>", "value": "<the value>", "confidence": <0..1> } ] }

${focus ? `Focus on: ${focus}.` : ""}
Common types include: sheet_number, spec_section, dimension, material, vendor,
contact, phone, email, address, line_item, quantity, unit_price, total, date,
rfi_id, submittal_id, room, drawing_title.
Skip purely decorative items. If nothing readable, return an empty entities array.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: mime, data: bytes.toString("base64") } },
            { text: prompt },
          ],
        }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini vision failed (${res.status}): ${txt.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let parsed: { entities?: ParseEntity[] } = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const entities: ParseEntity[] = Array.isArray(parsed.entities)
    ? parsed.entities.filter((e) => e && typeof e.type === "string" && typeof e.value === "string")
    : [];

  return { kind: "image", ...base, mime, entities };
}
