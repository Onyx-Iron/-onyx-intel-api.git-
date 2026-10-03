export interface PageSplitPayloadBase {
  document_id: string;
  tenant_id: string;
  project_id: string;
  original_path: string;
  user_id: string;
}

export type PageSplitPayload =
  | (PageSplitPayloadBase & {
      is_local_upload: true;
      /** Bucket that already holds original_path. Defaults to plans-bucket in the worker. */
      source_bucket?: string;
    })
  | (PageSplitPayloadBase & {
      drive_file_id: string;
      access_token: string;
    });

function getWorkerConfig(): { url: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  return {
    url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/page-split-worker`,
    serviceKey,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

export async function invokePageSplitWorker(
  payload: PageSplitPayload,
  maxAttempts = 3,
): Promise<void> {
  const { url, serviceKey } = getWorkerConfig();
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
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      continue;
    }

    if (res.ok) return;

    const detail = await res.text().catch(() => res.statusText);
    const err = new Error(`page-split-worker ${res.status}: ${detail.slice(0, 300)}`);
    if (!isRetryableStatus(res.status)) throw err;

    lastError = err;
    if (attempt === maxAttempts) throw lastError;
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }

  throw lastError ?? new Error("page-split-worker invoke failed");
}
