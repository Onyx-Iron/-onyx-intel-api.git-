/**
 * A failed Turbopack dynamic import stays rejected until the document reloads.
 * Reload once per tab when the sheet's PDF.js chunk fails. A second failure
 * stays on screen so the reload button can be used.
 */

export const PDFJS_CHUNK_RELOAD_KEY = "onyx:pdfjs-chunk-reload";

export interface ReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to load chunk|ChunkLoadError|Loading chunk [\w./-]+ failed/i.test(message);
}

/** "reload" the first time a chunk error is seen. "show" after that, and for every other error. */
export function chunkReloadDecision(error: unknown, storage: ReloadStorage): "reload" | "show" {
  if (!isChunkLoadError(error)) return "show";
  if (storage.getItem(PDFJS_CHUNK_RELOAD_KEY) === "1") return "show";
  storage.setItem(PDFJS_CHUNK_RELOAD_KEY, "1");
  return "reload";
}
