/** Shared helpers for direct-to-Supabase signed uploads (bypass Vercel body limits). */

import { PLANS_BUCKET } from "@/lib/documents/storage";

export const PLANS_UPLOAD_BUCKET = PLANS_BUCKET;

/** Soft threshold: above this, prefer signed/TUS over multipart through Vercel. */
export const VERCEL_SAFE_UPLOAD_BYTES = 3.5 * 1024 * 1024;

/** Prefer TUS resumable protocol above this size (spotty jobsite networks). */
export const TUS_THRESHOLD_BYTES = 50 * 1024 * 1024;

/** Hard ceiling aligned with plans-bucket file_size_limit (Supabase Pro). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

const SAFE_NAME_RE = /[^\w.\-]+/g;

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || "upload.bin";
  return base.replace(SAFE_NAME_RE, "_") || "upload.bin";
}

export function extensionOf(fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) return ".bin";
  return safe.slice(dot).toLowerCase();
}

/**
 * Storage object key under plans-bucket. PDF plan sets keep the
 * `originals/{id}.pdf` convention page-split-worker already expects;
 * CAD/other keep their real extension.
 */
export function buildOriginalStoragePath(documentId: string, fileName: string): string {
  const ext = extensionOf(fileName);
  if (ext === ".pdf") return `originals/${documentId}.pdf`;
  return `originals/${documentId}${ext}`;
}

export function parseSignedUploadPayload(signed: Record<string, unknown>): {
  url: string;
  token: string | null;
  path: string | null;
} {
  const url =
    (typeof signed.signedUrl === "string" && signed.signedUrl) ||
    (typeof signed.signedURL === "string" && signed.signedURL) ||
    (typeof signed.url === "string" && signed.url) ||
    "";
  const token = typeof signed.token === "string" ? signed.token : null;
  const path = typeof signed.path === "string" ? signed.path : null;
  return { url, token, path };
}

export function assertUploadSize(size: number | null | undefined): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  if (size > MAX_UPLOAD_BYTES) {
    return "File exceeds the 1GB limit. Split the drawing set and retry.";
  }
  return null;
}
