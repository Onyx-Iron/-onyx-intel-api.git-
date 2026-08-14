type FetchLike = typeof fetch;

export async function fetchWithRetry(
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1] = {},
  options: {
    retries?: number;
    retryDelayMs?: number;
    retryStatusCodes?: number[];
  } = {},
): Promise<Response> {
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 400;
  const retryStatusCodes = options.retryStatusCodes ?? [502, 503, 504];

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !retryStatusCodes.includes(res.status) || attempt === retries) {
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
  }

  throw lastErr instanceof Error ? lastErr : new Error("Request failed after retries.");
}
