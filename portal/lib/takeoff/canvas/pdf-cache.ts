const documents = new Map<string, Promise<unknown>>();

/** Reuse one PDF.js document promise per URL so a remount does not re-download it. */
export function cachedPdfDocument<T>(url: string, load: () => Promise<T>): Promise<T> {
  const existing = documents.get(url) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = load().catch((error: unknown) => {
    documents.delete(url);
    throw error;
  });
  documents.set(url, promise);
  return promise;
}

export function clearPdfDocumentCache(): void {
  documents.clear();
}
