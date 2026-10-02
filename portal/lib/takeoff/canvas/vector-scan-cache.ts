const scannedPageIds = new Set<string>();

/** A page whose vectors were already stored, or confirmed empty, this session. */
export function pageVectorScanDone(pageId: string): boolean {
  return scannedPageIds.has(pageId);
}

export function markPageVectorScanDone(pageId: string): void {
  scannedPageIds.add(pageId);
}

export function clearPageVectorScanCache(): void {
  scannedPageIds.clear();
}
