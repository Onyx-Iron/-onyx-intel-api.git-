/**
 * Pure planning for page-split retries.
 *
 * Re-running split must not delete document_pages that still exist: sheet
 * calibrations reference those ids with ON DELETE CASCADE, and manual
 * takeoffs / takeoff items lose their page link. Sheets are inserted by this
 * pipeline only, and document_page_id is UNIQUE when set — a delete-then-insert
 * of pages nulls that link and the next insert creates a second sheet per page.
 */

export interface ExistingDocumentPage {
  id: string;
  page_number: number;
  status: string | null;
  takeoff_status: string | null;
}

export interface PlannedPage {
  id: string;
  tenant_id: string;
  document_id: string;
  page_number: number;
  storage_path: string;
  /** True when this page number has no row yet. */
  insert: boolean;
  /** Re-run OCR. False when this page already finished. */
  enqueueOcr: boolean;
  /** Re-run takeoff extraction. False when this page already finished. */
  enqueueTakeoff: boolean;
}

export interface ExistingSheetRow {
  id: string;
  document_page_id: string | null;
  page_number: number | null;
}

export interface SheetPageRef {
  id: string;
  page_number: number;
  tenant_id: string;
  document_id: string;
  project_id: string;
}

export interface SheetInsert {
  tenant_id: string;
  project_id: string;
  document_id: string;
  document_page_id: string;
  page_number: number;
  processing_status: "pending";
}

export interface SheetUpdate {
  id: string;
  document_page_id: string;
  page_number: number;
}

function byId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function storagePath(documentId: string, pageNumber: number): string {
  return `pages/${documentId}/page-${pageNumber}.pdf`;
}

export function reconcileDocumentPages(args: {
  existing: ExistingDocumentPage[];
  /** Page numbers whose replacement PDF bytes uploaded successfully. */
  uploadedPageNumbers: number[];
  /** Page count of the source PDF. Higher page numbers are removed. */
  pageCount: number;
  tenantId: string;
  documentId: string;
  newId: () => string;
}): { pages: PlannedPage[]; deleteIds: string[] } {
  const uploaded = new Set(args.uploadedPageNumbers);
  const byNumber = new Map<number, ExistingDocumentPage[]>();
  const deleteIds: string[] = [];

  for (const row of args.existing) {
    if (!Number.isInteger(row.page_number) || row.page_number < 1 || row.page_number > args.pageCount) {
      deleteIds.push(row.id);
      continue;
    }
    const list = byNumber.get(row.page_number) ?? [];
    list.push(row);
    byNumber.set(row.page_number, list);
  }

  const pages: PlannedPage[] = [];
  for (let pageNumber = 1; pageNumber <= args.pageCount; pageNumber++) {
    const matches = byNumber.get(pageNumber) ?? [];
    matches.sort(byId);
    const keeper = matches[0];
    for (const extra of matches.slice(1)) deleteIds.push(extra.id);

    if (!keeper) {
      if (!uploaded.has(pageNumber)) continue;
      pages.push({
        id: args.newId(),
        tenant_id: args.tenantId,
        document_id: args.documentId,
        page_number: pageNumber,
        storage_path: storagePath(args.documentId, pageNumber),
        insert: true,
        enqueueOcr: true,
        enqueueTakeoff: true,
      });
      continue;
    }

    const bytesUpdated = uploaded.has(pageNumber);
    pages.push({
      id: keeper.id,
      tenant_id: args.tenantId,
      document_id: args.documentId,
      page_number: pageNumber,
      storage_path: storagePath(args.documentId, pageNumber),
      insert: false,
      // A failed re-upload must not reset a page we could not replace.
      enqueueOcr: bytesUpdated && keeper.status !== "done",
      enqueueTakeoff: bytesUpdated && keeper.takeoff_status !== "done",
    });
  }

  return { pages, deleteIds };
}

/**
 * One sheet per surviving page. Re-link orphans (page delete previously
 * nulled document_page_id) instead of inserting a second row, and drop
 * duplicates plus sheets for pages that no longer exist.
 */
export function reconcileSheets(args: {
  existing: ExistingSheetRow[];
  pages: SheetPageRef[];
  pageCount: number;
}): { inserts: SheetInsert[]; updates: SheetUpdate[]; deleteIds: string[] } {
  const claimed = new Set<string>();
  const inserts: SheetInsert[] = [];
  const updates: SheetUpdate[] = [];
  const remaining = [...args.existing].sort(byId);

  for (const page of args.pages) {
    const linked = remaining.find((sheet) => !claimed.has(sheet.id) && sheet.document_page_id === page.id);
    const byNumber = remaining.find((sheet) => !claimed.has(sheet.id) && sheet.page_number === page.page_number);
    const keeper = linked ?? byNumber;
    if (!keeper) {
      inserts.push({
        tenant_id: page.tenant_id,
        project_id: page.project_id,
        document_id: page.document_id,
        document_page_id: page.id,
        page_number: page.page_number,
        processing_status: "pending",
      });
      continue;
    }
    claimed.add(keeper.id);
    if (keeper.document_page_id !== page.id || keeper.page_number !== page.page_number) {
      updates.push({
        id: keeper.id,
        document_page_id: page.id,
        page_number: page.page_number,
      });
    }
  }

  const deleteIds = remaining
    .filter((sheet) => !claimed.has(sheet.id))
    .filter((sheet) => {
      const pageGone = sheet.page_number == null
        || sheet.page_number < 1
        || sheet.page_number > args.pageCount
        || !args.pages.some((page) => page.page_number === sheet.page_number);
      const duplicate = sheet.page_number != null && args.pages.some((page) => page.page_number === sheet.page_number);
      const danglingLink = sheet.document_page_id != null
        && !args.pages.some((page) => page.id === sheet.document_page_id);
      return pageGone || duplicate || danglingLink;
    })
    .map((sheet) => sheet.id);

  return { inserts, updates, deleteIds };
}
