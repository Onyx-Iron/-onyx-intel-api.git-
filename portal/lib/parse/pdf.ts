/**
 * PDF parser — uploads to the Gemini Files API, waits for ACTIVE, then asks
 * the model to extract structured entities biased by the optional hint.
 * Mirrors the upload/wait helpers used by app/api/documents/[id]/ingest.
 */
import type { ParseResult, ParseContext, ParseEntity } from "./index";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? "gemini-2.0-flash-001";

const HINT_FOCUS: Record<string, string> = {
  takeoff:   "quantities, materials, dimensions, areas, CSI codes, sheet numbers",
  estimate:  "line items, unit prices, quantities, totals, vendors",
  vendors:   "company names, contacts, phone numbers, emails, addresses, trades",
  invoices:  "invoice number, vendor, line items, amounts, totals, dates, terms",
  punch:     "punch items, locations, trades, status, dates",
  contacts:  "person names, roles, companies, phones, emails",
  docs:      "sheet numbers, spec sections, RFI/submittal IDs, dates, titles",
};

async function uploadPdf(pdf: Buffer, fileName: string): Promise<{ uri: string; name: string }> {
  const boundary = "onyx_boundary_gemini";
  const meta = JSON.stringify({ file: { displayName: fileName } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n`),
    Buffer.from(meta),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
    pdf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart`,
    {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": GEMINI_API_KEY,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini Files upload failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as { file: { name: string; uri: string; state: string } };
  return { uri: data.file.uri, name: data.file.name };
}

async function waitForActive(name: string, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}`,
      { headers: { "X-Goog-Api-Key": GEMINI_API_KEY } },
    );
    const data = (await res.json()) as { state: string };
    if (data.state === "ACTIVE") return;
    if (data.state === "FAILED") throw new Error("Gemini file processing failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Gemini file did not become active within 60 s");
}

async function deleteFile(name: string): Promise<void> {
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: "DELETE",
    headers: { "X-Goog-Api-Key": GEMINI_API_KEY },
  }).catch(() => {});
}

export async function parsePdf(
  bytes: Buffer,
  base: { filename: string; mime: string },
  ctx: ParseContext,
): Promise<ParseResult> {
  if (!GEMINI_API_KEY) {
    return { kind: "error", ...base, error: "GEMINI_API_KEY not configured" };
  }

  const focus = ctx.hint ? HINT_FOCUS[ctx.hint] ?? "" : "";
  const prompt = `Extract structured entities from this construction/engineering PDF.
Return ONLY JSON — no markdown — shaped:
{ "entities": [ { "type": "<short label>", "value": "<value>", "page": <1-indexed int>, "confidence": <0..1> } ] }

${focus ? `Focus on: ${focus}.` : ""}
Common types: sheet_number, spec_section, dimension, material, vendor, contact,
phone, email, address, line_item, quantity, unit_price, total, date, rfi_id,
submittal_id, room, drawing_title. Omit purely decorative items.`;

  const { uri, name } = await uploadPdf(bytes, base.filename);
  try {
    await waitForActive(name);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { fileData: { mimeType: "application/pdf", fileUri: uri } },
              { text: prompt },
            ],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini PDF extraction failed (${res.status}): ${txt.slice(0, 300)}`);
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
    return { kind: "image", ...base, mime: "application/pdf", entities };
  } finally {
    await deleteFile(name);
  }
}
