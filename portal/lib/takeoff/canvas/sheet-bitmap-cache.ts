export interface SheetBitmapEntry<T> {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  bitmap: T;
}

const MAX_SHEETS = 4;
const cache = new Map<string, SheetBitmapEntry<{ close?: () => void }>>();

/** The pdf.js viewport scale SheetCanvas uses for the current container. */
export function sheetRenderScale(containerWidth: number, pageWidth: number): number {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(pageWidth) || pageWidth <= 0) return 1;
  return Math.min(2.5, Math.max(0.5, (containerWidth - 380) / pageWidth));
}

export function rememberSheetBitmap<T extends { close?: () => void }>(pageId: string, entry: SheetBitmapEntry<T>): void {
  const previous = cache.get(pageId);
  if (previous && previous.bitmap !== entry.bitmap) previous.bitmap.close?.();
  cache.delete(pageId);
  cache.set(pageId, entry);
  while (cache.size > MAX_SHEETS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    evicted?.bitmap.close?.();
  }
}

/** The cached paint when this container would render at the same scale. */
export function matchingSheetBitmap<T extends { close?: () => void }>(pageId: string, containerWidth: number): SheetBitmapEntry<T> | null {
  const entry = cache.get(pageId);
  if (!entry) return null;
  const scale = sheetRenderScale(containerWidth, entry.pageWidth);
  if (Math.abs(scale - entry.scale) > 0.001) return null;
  cache.delete(pageId);
  cache.set(pageId, entry);
  return entry as SheetBitmapEntry<T>;
}

export function clearSheetBitmapCache(): void {
  for (const entry of cache.values()) entry.bitmap.close?.();
  cache.clear();
}
