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
