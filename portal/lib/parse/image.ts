/**
 * Image parser. The file is stored. A raster sheet has no embedded text to
 * measure, and this path does not call a vision model to invent any.
 */
import type { ParseResult, ParseContext } from "./index";

export async function parseImage(
  _bytes: Buffer,
  base: { filename: string; mime: string },
  _ctx: ParseContext,
): Promise<ParseResult> {
  return {
    kind: "image",
    ...base,
    text: "",
    entities: [],
  };
}
