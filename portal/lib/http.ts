/**
 * HTTP header values must be ByteStrings (Latin-1, code points 0-255).
 * Env vars or copy-pasted secrets sometimes carry a UTF-8 BOM (U+FEFF) or other
 * non-Latin1 characters, which makes `fetch` throw:
 *   "Cannot convert argument to a ByteString ... value of 65279 ..."
 * headerSafe strips any code point above 0xFF so a stray BOM can never crash an
 * outbound request, then trims surrounding whitespace.
 */
export function headerSafe(value: string | undefined | null): string {
  if (!value) return "";
  let out = "";
  for (const ch of value) {
    if (ch.codePointAt(0)! <= 0xff) out += ch;
  }
  return out.trim();
}

/** Negotiate gzip + Brotli for API responses (server-side fetch and client helpers). */
export const ACCEPT_ENCODING = "gzip, br" as const;

export const COMPRESSION_HEADERS: Readonly<Record<string, string>> = {
  "Accept-Encoding": ACCEPT_ENCODING,
};

/** Merge compression negotiation into an existing header map. */
export function withCompressionHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  return { ...COMPRESSION_HEADERS, ...headers };
}

/**
 * Browser or server fetch with compression headers applied when absent.
 * Browsers may ignore Accept-Encoding (forbidden header); Node/server fetch honors it.
 */
export function clientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept-Encoding")) {
    headers.set("Accept-Encoding", ACCEPT_ENCODING);
  }
  return fetch(input, { ...init, headers });
}
