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
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(openaiKey ? { ...payload, openai_api_key: openaiKey } : payload),
  });

  if (res.ok) return;

  const detail = await res.text().catch(() => res.statusText);
  throw new Error(`page-split-worker ${res.status}: ${detail.slice(0, 300)}`);
}
