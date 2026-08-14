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

export async function invokePageSplitWorker(payload: PageSplitPayload): Promise<void> {
  const { url, serviceKey } = getWorkerConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return;

  const detail = await res.text().catch(() => res.statusText);
  throw new Error(`page-split-worker ${res.status}: ${detail.slice(0, 300)}`);
}

let lastPipelineProbe: { checkedAt: number; healthy: boolean } | null = null;

async function functionBoots(name: "page-split-worker" | "page-takeoff-worker"): Promise<boolean> {
  const { url, serviceKey } = getWorkerConfig();
  const res = await fetch(url.replace(/page-split-worker$/, name), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).catch(() => null);
  if (!res) return false;
  const detail = await res.text().catch(() => "");
  return !(res.status === 503 && detail.includes("BOOT_ERROR"));
}

/** Prevents routing a document into an Edge pipeline that cannot boot. */
export async function pageSplitPipelineHealthy(): Promise<boolean> {
  if (lastPipelineProbe && Date.now() - lastPipelineProbe.checkedAt < 60_000) {
    return lastPipelineProbe.healthy;
  }
  const checks = await Promise.all([
    functionBoots("page-split-worker"),
    functionBoots("page-takeoff-worker"),
  ]);
  const healthy = checks.every(Boolean);
  lastPipelineProbe = { checkedAt: Date.now(), healthy };
  return healthy;
}
