import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";

export type PriceReviewDecision = "approved" | "rejected";

export function buildPriceReviewPayload(
  observation: Record<string, unknown>,
  decision: PriceReviewDecision,
  reason: string,
) {
  if (observation.approval_status !== "unreviewed") throw new Error("Only unreviewed price evidence can be reviewed");
  const trimmedReason = reason.trim();
  if (decision === "rejected" && trimmedReason.length < 3) throw new Error("A rejection reason is required");
  return {
    observation,
    decision,
    reason: trimmedReason || null,
    authoritativeAfterReview: decision === "approved" && observation.source_kind !== "ai_estimate",
  };
}

export function buildPriceReviewPreview(
  observation: Record<string, unknown>,
  decision: PriceReviewDecision,
  reason: string,
) {
  const payload = buildPriceReviewPayload(observation, decision, reason);
  return { payload, payloadHash: hashApprovalPayload(payload) };
}
