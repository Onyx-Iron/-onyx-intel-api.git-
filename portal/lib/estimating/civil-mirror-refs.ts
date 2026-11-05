/**
 * `sheet_id` is the plan page. `document_id` is the parent plan file.
 * Those columns have different foreign keys, so a page id must never be
 * written into `document_id`.
 */
export function civilMirrorTakeoffRefs(
  pageId: string | null,
  parentDocumentId: string | null,
): { document_id: string | null; sheet_id: string | null } {
  if (!pageId) return { document_id: null, sheet_id: null };
  return { document_id: parentDocumentId, sheet_id: pageId };
}
