export interface IngestPage {
  page_number: number;
}

/** Pages that do not yet have a saved chunk, in their original order. */
export function pagesStillNeedingChunks<T extends IngestPage>(
  pages: T[],
  chunkedPageNumbers: Iterable<number>,
): T[] {
  const done = new Set(chunkedPageNumbers);
  return pages.filter((page) => !done.has(page.page_number));
}
