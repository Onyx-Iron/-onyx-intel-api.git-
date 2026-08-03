function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function summarizeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface GeminiRetryOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  label?: string;
}

export async function fetchGemini(
  url: string,
  init: RequestInit,
  options: GeminiRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const label = options.label ?? "Gemini request";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        return response;
      }

      const detail = (await response.text().catch(() => response.statusText)).slice(0, 300);
      lastError = new Error(`${label} failed (${response.status}): ${detail}`);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) throw err;
    } finally {
      clearTimeout(timeout);
    }

    await sleep(500 * 2 ** (attempt - 1));
  }

  throw new Error(summarizeError(lastError) || `${label} failed`);
}

export async function readGeminiError(response: Response, label: string): Promise<never> {
  const detail = (await response.text().catch(() => response.statusText)).slice(0, 300);
  throw new Error(`${label} failed (${response.status}): ${detail}`);
}
