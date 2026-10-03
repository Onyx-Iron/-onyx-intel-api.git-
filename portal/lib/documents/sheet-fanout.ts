export interface SheetFanoutJob {
  page_id: string;
  document_id: string;
  tenant_id: string;
  project_id: string;
  page_number: number;
  storage_path: string;
}

export function sheetFanoutEndpoints(supabaseUrl: string): { processorUrl: string; takeoffUrl: string } {
  const base = supabaseUrl.replace(/\/$/, "");
  return {
    processorUrl: `${base}/functions/v1/page-processor`,
    takeoffUrl: `${base}/functions/v1/page-takeoff-worker`,
  };
}

/**
 * Same two workers the page-split function calls after a large plan is
 * burst. Small PDFs are split inside the ingest request, so they have to
 * enqueue OCR and CSI takeoff themselves.
 */
export async function fanOutSheetJobs(args: {
  jobs: SheetFanoutJob[];
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ attempted: number; failures: number }> {
  if (args.jobs.length === 0) return { attempted: 0, failures: 0 };
  const { processorUrl, takeoffUrl } = sheetFanoutEndpoints(args.supabaseUrl);
  const fetchImpl = args.fetchImpl ?? fetch;
  const calls = args.jobs.flatMap((job) => [processorUrl, takeoffUrl].map((url) => ({ url, job })));
  const results = await Promise.allSettled(calls.map(({ url, job }) => fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_id: job.page_id,
      document_id: job.document_id,
      tenant_id: job.tenant_id,
      project_id: job.project_id,
      page_number: job.page_number,
      storage_path: job.storage_path,
    }),
  })));
  let failures = 0;
  for (const result of results) {
    if (result.status === "rejected" || !result.value.ok) failures += 1;
  }
  return { attempted: results.length, failures };
}
