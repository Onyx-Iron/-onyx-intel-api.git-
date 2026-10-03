import { PDFDocument } from "pdf-lib";

/** Plan sets at or above this size are split by page-split-worker, not in the request. */
export const ASYNC_SPLIT_BYTES = 3.5 * 1024 * 1024;

export function looksLikePdf(fileName: string, contentType?: string | null): boolean {
  const name = fileName.toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  return name.endsWith(".pdf") || type.includes("pdf");
}

export interface SheetPageStore {
  countExisting(documentId: string, tenantId: string): Promise<number>;
  uploadPage(storagePath: string, bytes: Uint8Array): Promise<void>;
  insertPages(rows: SheetPageRow[]): Promise<void>;
}

export interface SheetPageRow {
  id: string;
  tenant_id: string;
  document_id: string;
  page_number: number;
  storage_path: string;
  status: string;
}

export async function splitPdfIntoPages(pdfBytes: Uint8Array): Promise<Uint8Array[]> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const count = pdf.getPageCount();
  const pages: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(pdf, [i]);
    single.addPage(copied);
    pages.push(await single.save());
  }
  return pages;
}

/**
 * Writes one plans-bucket PDF per sheet and a matching document_pages row.
 * Skips work when every page is already recorded. The canvas reads these
 * rows; the Gemini `pages` summary table is not a sheet.
 */
export async function publishSheetPages(
  store: SheetPageStore,
  args: { tenantId: string; documentId: string; pdfBytes: Uint8Array },
): Promise<number> {
  const pages = await splitPdfIntoPages(args.pdfBytes);
  const existing = await store.countExisting(args.documentId, args.tenantId);
  if (existing >= pages.length && pages.length > 0) return existing;

  const rows: SheetPageRow[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const storagePath = `pages/${args.documentId}/page-${pageNumber}.pdf`;
    await store.uploadPage(storagePath, pages[i]);
    rows.push({
      id: crypto.randomUUID(),
      tenant_id: args.tenantId,
      document_id: args.documentId,
      page_number: pageNumber,
      storage_path: storagePath,
      status: "pending",
    });
  }
  if (rows.length > 0) await store.insertPages(rows);
  return rows.length;
}
