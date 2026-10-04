/**
 * Photos are not a source file. Measurements and text come from a PDF or DXF.
 */
import type { ParseResult, ParseContext } from "./index";

export async function parseImage(
  _bytes: Buffer,
  base: { filename: string; mime: string },
  _ctx: ParseContext,
): Promise<ParseResult> {
  return {
    kind: "error",
    ...base,
    error: "Upload a PDF or DXF. A photo is not a source file for measurement or extraction.",
  };
}
