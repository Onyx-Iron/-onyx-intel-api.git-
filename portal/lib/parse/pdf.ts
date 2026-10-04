/**
 * PDF parser. Reads the embedded text layer and any printed scale.
 * A scanned page with no text stays unread. This path does not call a model.
 */
import type { ParseResult, ParseContext, ParseEntity } from "./index";
import { readPdfPageText } from "@/lib/documents/extraction-fallback";
import { feetPerPointFromPrintedScale } from "@/lib/takeoff/stated-scale";

export async function parsePdf(
  bytes: Buffer,
  base: { filename: string; mime: string },
  _ctx: ParseContext,
): Promise<ParseResult> {
  const pages = await readPdfPageText(bytes);
  const entities: ParseEntity[] = [];
  const textParts: string[] = [];
  for (const page of pages) {
    if (!page.text.trim()) continue;
    textParts.push(page.text);
    const scale = feetPerPointFromPrintedScale(page.text);
    if (scale) {
      entities.push({
        type: "printed_scale",
        value: scale.scaleText,
        page: page.pageNumber,
        confidence: 1,
      });
    }
  }
  return {
    kind: "text",
    ...base,
    mime: "application/pdf",
    text: textParts.join("\n"),
    entities,
  };
}
