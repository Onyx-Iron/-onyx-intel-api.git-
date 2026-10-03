import { extractVectorsFromOperatorList, type ExtractedVector, type VectorExtractInput } from "./pdf-vector-extract";

/**
 * Collect a pdf.js page's operators, then walk them off the main thread.
 * Kept out of pdf-vector-extract.ts so the worker bundle does not import
 * the module that starts the worker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function extractVectorsFromPdfPage(page: any): Promise<ExtractedVector[]> {
  const ops = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const input: VectorExtractInput = {
    fnArray: Array.from(ops.fnArray as ArrayLike<number>),
    argsArray: ops.argsArray as unknown[],
    textItems: (textContent.items ?? []) as VectorExtractInput["textItems"],
  };
  if (typeof window === "undefined") return extractVectorsFromOperatorList(input);
  const { extractVectorsOffMainThread } = await import("./vector-extract-client");
  return extractVectorsOffMainThread(input);
}
