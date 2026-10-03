/**
 * Invoke per-page Edge workers (OCR / takeoff) from the Next.js portal.
 * Mirrors page-split-worker's fan-out payload contract.
 */

export interface PageWorkerPayload {
  page_id: string;
  document_id: string;
  tenant_id: string;
  project_id: string;
  page_number: number;
  storage_path: string;
}

function getSupabaseFunctionsBase(): { base: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  return { base: supabaseUrl.replace(/\/$/, ""), serviceKey };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function invokeFunction(
  slug: "page-processor" | "page-takeoff-worker",
  payload: PageWorkerPayload,
  maxAttempts = 3,
): Promise<void> {
  const { base, serviceKey } = getSupabaseFunctionsBase();
  const url = `${base}/functions/v1/${slug}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) throw lastError;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      continue;
    }

    if (res.ok) return;

    const detail = await res.text().catch(() => res.statusText);
    const err = new Error(`${slug} ${res.status}: ${detail.slice(0, 300)}`);
    if (!isRetryableStatus(res.status)) throw err;
    lastError = err;
    if (attempt === maxAttempts) throw lastError;
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }

  throw lastError ?? new Error(`${slug} invoke failed`);
}

export function invokePageProcessor(payload: PageWorkerPayload): Promise<void> {
  return invokeFunction("page-processor", payload);
}

export function invokePageTakeoffWorker(payload: PageWorkerPayload): Promise<void> {
  return invokeFunction("page-takeoff-worker", payload);
}
