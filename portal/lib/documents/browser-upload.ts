"use client";

import * as tus from "tus-js-client";
import { TUS_THRESHOLD_BYTES } from "@/lib/documents/signed-upload";
import { shouldRetryUploadComplete } from "@/lib/documents/ingest-start";

export type UploadProgress = { bytesSent: number; bytesTotal: number; percent: number };

export interface DirectUploadResult {
  documentId: string;
  path: string;
  method: "put" | "tus";
}

interface UploadUrlResponse {
  document_id?: string;
  path?: string;
  reused?: boolean;
  skip_upload?: boolean;
  upsert?: boolean;
  prefer_tus?: boolean;
  upload?: { url?: string; token?: string | null; path?: string; method?: string };
  tus?: {
    endpoint: string;
    headers: Record<string, string>;
    metadata: Record<string, string>;
    chunkSize?: number;
  } | null;
  error?: string;
}

function progressOf(sent: number, total: number): UploadProgress {
  const bytesTotal = total > 0 ? total : 0;
  const percent = bytesTotal > 0 ? Math.min(100, Math.round((sent / bytesTotal) * 100)) : 0;
  return { bytesSent: sent, bytesTotal, percent };
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** PUT file bytes to a signed URL with upload progress (XHR — fetch has no upload progress). */
export function putToSignedUrl(
  url: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
  upsert = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", upsert ? "true" : "false");

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      onProgress?.(progressOf(ev.loaded, ev.total));
    };
    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(progressOf(file.size, file.size));
        resolve();
        return;
      }
      reject(new Error(`Storage upload failed (${xhr.status}): ${xhr.responseText?.slice(0, 200) || xhr.statusText}`));
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Storage upload network error"));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    xhr.send(file);
  });
}

function tusUpload(
  file: File,
  tusConfig: NonNullable<UploadUrlResponse["tus"]>,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: tusConfig.endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: tusConfig.headers,
      metadata: tusConfig.metadata,
      chunkSize: tusConfig.chunkSize ?? 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: (error) => reject(error instanceof Error ? error : new Error(String(error))),
      onProgress: (bytesSent, bytesTotal) => onProgress?.(progressOf(bytesSent, bytesTotal)),
      onSuccess: () => resolve(),
    });

    const onAbort = () => {
      void upload.abort(true).catch(() => undefined);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    upload.findPreviousUploads().then((previous) => {
      if (signal?.aborted) return;
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch((err) => {
      // No prior upload — start fresh.
      if (signal?.aborted) return;
      try {
        upload.start();
      } catch (startErr) {
        reject(err instanceof Error ? err : startErr instanceof Error ? startErr : new Error(String(startErr)));
      }
    });
  });
}

/**
 * Direct-to-Supabase upload for plan PDFs / DWGs:
 * 1) Tiny JSON request for a signed URL (and optional TUS config)
 * 2) Browser streams bytes to Storage (PUT or TUS) — never through Vercel
 * 3) Complete endpoint verifies object + fires ingest / page-split offload
 */
export async function uploadDocumentDirect(
  file: File,
  projectId: string,
  opts?: {
    onProgress?: (p: UploadProgress) => void;
    signal?: AbortSignal;
  },
): Promise<DirectUploadResult> {
  const sessionRes = await fetch("/api/documents/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      file_name: file.name,
      size: file.size,
      content_type: file.type || "application/octet-stream",
      content_sha256: await sha256Hex(file),
    }),
    signal: opts?.signal,
  });
  const session = await sessionRes.json().catch(() => ({})) as UploadUrlResponse;
  if (!sessionRes.ok || !session.document_id) {
    throw new Error(session.error ?? `Could not start upload (${sessionRes.status})`);
  }
  if (session.skip_upload) {
    return {
      documentId: session.document_id,
      path: session.path ?? "",
      method: "put",
    };
  }

  const preferTus = session.prefer_tus || file.size >= TUS_THRESHOLD_BYTES;
  let method: "put" | "tus" = "put";

  if (preferTus && session.tus?.endpoint) {
    try {
      await tusUpload(file, session.tus, opts?.onProgress, opts?.signal);
      method = "tus";
    } catch (tusErr) {
      // Fall back to single signed PUT if TUS auth/bucket policy isn't available.
      if (!session.upload?.url) throw tusErr;
      console.warn("[browser-upload] TUS failed, falling back to signed PUT", tusErr);
      await putToSignedUrl(session.upload.url, file, opts?.onProgress, opts?.signal, session.upsert === true);
      method = "put";
    }
  } else {
    if (!session.upload?.url) {
      throw new Error(session.error ?? "No signed upload URL returned");
    }
    await putToSignedUrl(session.upload.url, file, opts?.onProgress, opts?.signal, session.upsert === true);
  }

  let completeRes: Response | null = null;
  let completeData: { error?: string } = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      completeRes = await fetch("/api/documents/upload-url/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: session.document_id }),
        signal: opts?.signal,
      });
      completeData = await completeRes.json().catch(() => ({})) as { error?: string };
      if (completeRes.ok) break;
      if (!shouldRetryUploadComplete(completeRes.status, attempt)) break;
    } catch (err) {
      if (opts?.signal?.aborted || !shouldRetryUploadComplete(null, attempt)) throw err;
      completeRes = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  if (!completeRes?.ok) {
    throw new Error(completeData.error ?? `Could not finalize upload (${completeRes?.status ?? "network"})`);
  }

  return {
    documentId: session.document_id,
    path: session.path ?? session.upload?.path ?? "",
    method,
  };
}
