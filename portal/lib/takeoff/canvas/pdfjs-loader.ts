/**
 * Shared PDF.js entry for the sheet canvas.
 * The worker is a static file under public/, copied from pdfjs-dist when
 * Next loads its config, so Turbopack does not have to emit the worker URL.
 */

export const PDFJS_WORKER_SRC = "/pdf.worker.min.mjs";

export async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  return pdfjs;
}
