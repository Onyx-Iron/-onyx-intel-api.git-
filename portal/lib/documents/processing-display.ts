/**
 * User-facing stages and gates for upload → ingest → takeoff.
 * Quantities are blocked until every page is accounted for, and only
 * drawings may emit quantities.
 */

export const DOCUMENT_CLASSES = [
  "drawing",
  "spec",
  "rfi",
  "submittal",
  "report",
  "contract",
  "correspondence",
  "other",
] as const;

export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export type ProcessingStage =
  | "Uploading"
  | "Splitting"
  | "Reading pages"
  | "Indexing"
  | "Complete"
  | "Partial"
  | "Failed";

export interface ProcessingDocument {
  status: string;
  split_status?: string | null;
  ocr_status?: string | null;
  vector_status?: string | null;
  doc_type?: string | null;
  page_count?: number | null;
  last_error?: string | null;
  last_error_step?: string | null;
  uploaded_at?: string | null;
  meta?: Record<string, unknown> | null;
}

const QUANTITY_DOC_TYPES = new Set<string>(["drawing"]);

export function normalizeDocumentClass(value: string | null | undefined): DocumentClass {
  const raw = (value ?? "").trim().toLowerCase();
  if ((DOCUMENT_CLASSES as readonly string[]).includes(raw)) return raw as DocumentClass;
  if (raw === "correspondance") return "correspondence";
  return "other";
}

export function quantitiesAllowedForDocType(docType: string | null | undefined): boolean {
  if (!docType) return false;
  return QUANTITY_DOC_TYPES.has(docType);
}

export function processingStage(doc: ProcessingDocument): ProcessingStage {
  const status = doc.status;
  if (status === "error" || status === "failed") return "Failed";
  if (status === "complete_with_errors") return "Partial";
  if (status === "complete" || status === "ready" || status === "done") return "Complete";
  const splitInFlight = status === "queued"
    || doc.split_status === "pending"
    || doc.split_status === "processing";
  if (splitInFlight) {
    if (status === "processing" && (doc.ocr_status === "processing" || doc.ocr_status === "done")) {
      // fall through to page-reading / indexing
    } else if (status !== "processing") {
      return "Splitting";
    }
  }
  if (status === "split") {
    if (doc.vector_status === "processing" || doc.ocr_status === "done" || doc.ocr_status === "partially_completed") {
      return "Indexing";
    }
    return "Reading pages";
  }
  if (status === "processing") {
    if (doc.vector_status === "processing" || doc.ocr_status === "done" || doc.ocr_status === "partially_completed") {
      return "Indexing";
    }
    return "Reading pages";
  }
  return "Uploading";
}

export function plainLanguageError(error: string | null | undefined, step?: string | null): string | null {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (lower.includes("password") || lower.includes("encrypt")) {
    return "This PDF is password-protected. Enter the password to continue.";
  }
  if (lower.includes("decrypt") && lower.includes("rewrite")) {
    return "The password was accepted, but this file could not be rewritten without protection. Export an unprotected PDF and upload that copy.";
  }
  if (lower.includes("wrong password") || lower.includes("password_rejected") || lower.includes("incorrect password")) {
    return "That password did not unlock this PDF.";
  }
  if (lower.includes("corrupt") || lower.includes("malformed")) {
    return "This file could not be read. It may be damaged. Export a new PDF and upload that copy.";
  }
  if (lower.includes("too large")) {
    return "This document is too large for automatic analysis. It will be split into pages, or you can upload a smaller file.";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("budget")) {
    return "Processing stopped before it finished. Retry to continue.";
  }
  if (lower.includes("not connected") && lower.includes("google")) {
    return "Google Drive is not connected. Connect Google, then retry.";
  }
  const trimmed = error.replace(/^\[POST \/api\/documents\/[^\]]+\]\s*/i, "").trim();
  return step ? `${step}: ${trimmed}` : trimmed;
}

export function isPasswordRequired(error: string | null | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes("password") || lower.includes("encrypt");
}

export function missingPageNumbers(expectedCount: number, present: number[]): number[] {
  if (!Number.isFinite(expectedCount) || expectedCount <= 0) return [];
  const have = new Set(present.filter((n) => Number.isInteger(n) && n > 0));
  const missing: number[] = [];
  const cap = Math.min(expectedCount, 5000);
  for (let page = 1; page <= cap; page++) {
    if (!have.has(page)) missing.push(page);
  }
  return missing;
}

export function partialWasAcknowledged(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.partial_acknowledged === true;
}

export function listedMissingPages(doc: ProcessingDocument): number[] {
  const summary = doc.meta?.processing_summary;
  if (!summary || typeof summary !== "object") return [];
  const raw = (summary as Record<string, unknown>).missing_page_numbers;
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => typeof n === "number");
}

/**
 * Why takeoff must not run. Null means the user can measure this file.
 * A partial file stays blocked until failed pages succeed or the user
 * dismisses the listed missing pages.
 */
export function takeoffBlockReason(doc: ProcessingDocument): string | null {
  if (!quantitiesAllowedForDocType(doc.doc_type)) {
    return "Only drawings produce quantities. This file stays available to search.";
  }
  const stage = processingStage(doc);
  if (stage === "Failed") {
    return plainLanguageError(doc.last_error, doc.last_error_step) ?? "This file failed processing. Retry before takeoff.";
  }
  if (stage === "Partial") {
    const missing = listedMissingPages(doc);
    const named = missing.length > 0 ? ` Missing pages: ${missing.join(", ")}.` : "";
    if (!partialWasAcknowledged(doc.meta)) {
      return `Takeoff is blocked until failed pages are retried or you confirm you want to continue without them.${named}`;
    }
    return null;
  }
  if (stage !== "Complete") {
    return `This file is still ${stage.toLowerCase()}. Takeoff opens when processing finishes.`;
  }
  return null;
}

const STALL_MS = 5 * 60 * 1000;

/** An in-flight file that has not finished within five minutes of upload. */
export function processingStall(doc: ProcessingDocument, nowMs: number = Date.now()): string | null {
  const stage = processingStage(doc);
  if (stage === "Complete" || stage === "Partial" || stage === "Failed") return null;
  if (!doc.uploaded_at) return null;
  const uploaded = Date.parse(doc.uploaded_at);
  if (!Number.isFinite(uploaded)) return null;
  if (nowMs - uploaded < STALL_MS) return null;
  return `This file has been ${stage.toLowerCase()} for more than 5 minutes. Retry it.`;
}

export function pdfDeclaresEncryption(bytes: Uint8Array): boolean {
  const slice = bytes.subarray(0, Math.min(bytes.length, 2_000_000));
  const text = Buffer.from(slice).toString("latin1");
  return /\/Encrypt\b/.test(text);
}

export type PasswordAttempt =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: "not_encrypted" | "password_required" | "password_rejected" | "decrypt_unsupported"; message: string };

export function decidePasswordAttempt(args: {
  declaresEncryption: boolean;
  passwordProvided: boolean;
  opened: boolean;
  savedBytes: Uint8Array | null;
}): PasswordAttempt {
  if (!args.declaresEncryption) {
    return { ok: false, code: "not_encrypted", message: "This PDF is not password-protected." };
  }
  if (!args.passwordProvided) {
    return {
      ok: false,
      code: "password_required",
      message: "This PDF is password-protected. Enter the password to continue.",
    };
  }
  if (!args.opened || !args.savedBytes) {
    return { ok: false, code: "password_rejected", message: "That password did not unlock this PDF." };
  }
  if (pdfDeclaresEncryption(args.savedBytes)) {
    return {
      ok: false,
      code: "decrypt_unsupported",
      message: "The password was accepted, but this file could not be rewritten without protection. Export an unprotected PDF and upload that copy.",
    };
  }
  return { ok: true, bytes: args.savedBytes };
}
