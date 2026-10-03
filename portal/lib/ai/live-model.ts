/** Models Google has shut down. A configured env value in this set must not be sent. */
const RETIRED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "text-embedding-004",
]);

/** Replacement for the shut-down Gemini 2.0 Flash extract models. */
export const DOCUMENT_EXTRACT_MODEL = "gemini-3.6-flash";

/** Replacement for text-embedding-004. Request 768 dims so existing pgvector columns still fit. */
export const DOCUMENT_EMBED_MODEL = "gemini-embedding-2";

export const EMBEDDING_DIMENSIONS = 768;

export function liveModel(configured: string | undefined, fallback: string): string {
  const value = configured?.trim();
  if (!value || RETIRED_MODELS.has(value)) return fallback;
  return value;
}
