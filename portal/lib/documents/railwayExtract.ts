import { headerSafe } from "@/lib/http";
import { pythonApiHeaders } from "@/lib/python-api";
import { PLANS_BUCKET } from "@/lib/documents/storage";

const PYTHON_API_URL = () =>
  (headerSafe(process.env.PYTHON_API_URL) || "http://localhost:5050").replace(/\/$/, "");

/** CAD / IFC types that must not be parsed inside Vercel — Celery on Railway. */
export const RAILWAY_EXTRACT_EXTS = new Set([".dwg", ".dxf", ".ifc"]);

export function shouldEnqueueRailwayExtract(fileName: string): boolean {
  const ext = fileName.includes(".")
    ? `.${fileName.split(".").pop()!.toLowerCase()}`
    : "";
  return RAILWAY_EXTRACT_EXTS.has(ext);
}

export interface RailwayEnqueueResult {
  job_id: string;
  poll_url?: string;
  status?: string;
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl?: string } | null; error: { message: string } | null }>;
    };
  };
};

/**
 * Create a short-lived signed download URL for an object already in
 * plans-bucket, then enqueue Railway Celery `extract-async` so ezdxf /
 * ProcessPool work never runs inside a Vercel Serverless timeout.
 */
export async function enqueueRailwayExtractFromStorage(args: {
  db: StorageClient;
  storagePath: string;
  fileName: string;
  tenantId: string;
  projectId: string | null;
  email?: string | null;
}): Promise<RailwayEnqueueResult> {
  const { db, storagePath, fileName, tenantId, projectId, email } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await (db.storage.from(PLANS_BUCKET) as any)
    .createSignedUrl(storagePath, 60 * 60); // 1h — enough for the worker to pull
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Could not sign download URL: ${signErr?.message ?? "unknown"}`);
  }

  const url = new URL(`${PYTHON_API_URL()}/api/takeoff/extract-async`);
  url.searchParams.set("source_url", signed.signedUrl);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...pythonApiHeaders({
        email: email ?? null,
        tenantId,
        projectId: projectId ?? "",
      }),
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch { /* keep */ }
    throw new Error(`Railway extract-async failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as RailwayEnqueueResult;
  if (!data.job_id) throw new Error("Railway extract-async returned no job_id");
  return data;
}
