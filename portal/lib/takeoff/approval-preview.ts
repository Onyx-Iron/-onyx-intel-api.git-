import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Approval payload contains a non-finite number");
  return value;
}

export function hashApprovalPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export interface ApprovalPreview<T = unknown> {
  payloadHash: string;
  payload: T;
  expiresAt: string;
  actorUserId: string;
}

export type ApprovalValidation = { valid: true } | { valid: false; reason: "expired" | "wrong_actor" | "candidate_changed" | "corrupt_preview" };

export function validateApprovalPreview<T>(
  preview: ApprovalPreview<T>,
  current: { now: Date; actorUserId: string; payload: T },
): ApprovalValidation {
  if (hashApprovalPayload(preview.payload) !== preview.payloadHash) return { valid: false, reason: "corrupt_preview" };
  if (current.now.getTime() >= Date.parse(preview.expiresAt)) return { valid: false, reason: "expired" };
  if (current.actorUserId !== preview.actorUserId) return { valid: false, reason: "wrong_actor" };
  if (hashApprovalPayload(current.payload) !== preview.payloadHash) return { valid: false, reason: "candidate_changed" };
  return { valid: true };
}
