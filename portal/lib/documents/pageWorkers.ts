/**
 * Invoke Supabase Edge page workers (OCR / takeoff) with the same payload
 * shape page-split-worker uses when fanning out.
 */

export type PageWorkerKind = "ocr" | "takeoff";

export interface PageWorkerPayload {
  page_id: string;
  document_id: string;
  tenant_id: string;
  project_id: string;
  page_number: number;
  storage_path: string;
}

function getSupabaseBase(): { url: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  return { url: supabaseUrl.replace(/\/$/, ""), serviceKey };
}

function workerPath(kind: PageWorkerKind): string {
  return kind === "ocr" ? "page-processor" : "page-takeoff-worker";
}

export async function invokePageWorker(
  kind: PageWorkerKind,
  payload: PageWorkerPayload,
): Promise<void> {
  const { url, serviceKey } = getSupabaseBase();
  const res = await fetch(`${url}/functions/v1/${workerPath(kind)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${workerPath(kind)} ${res.status}: ${detail.slice(0, 300)}`);
  }
}
