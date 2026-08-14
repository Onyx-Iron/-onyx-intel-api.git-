type FetchLike = typeof fetch;

let lastProbe: { checkedAt: number; healthy: boolean } | null = null;

function workerConfiguration(): { baseUrl: string; serviceKey: string } | null {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return baseUrl && serviceKey ? { baseUrl: baseUrl.replace(/\/$/, ""), serviceKey } : null;
}

async function functionBoots(name: string, fetcher: FetchLike): Promise<boolean> {
  const config = workerConfiguration();
  if (!config) return false;
  const response = await fetcher(`${config.baseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  if (!response) return false;
  const detail = await response.text().catch(() => "");
  return !(response.status === 503 && detail.includes("BOOT_ERROR"));
}

/** Avoids stranding a document in an Edge pipeline whose functions cannot boot. */
export async function pageSplitPipelineHealthy(fetcher: FetchLike = fetch): Promise<boolean> {
  if (fetcher === fetch && lastProbe && Date.now() - lastProbe.checkedAt < 60_000) return lastProbe.healthy;
  const healthy = (await Promise.all([
    functionBoots("page-split-worker", fetcher),
    functionBoots("page-takeoff-worker", fetcher),
  ])).every(Boolean);
  if (fetcher === fetch) lastProbe = { checkedAt: Date.now(), healthy };
  return healthy;
}
