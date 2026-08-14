export type LegacyReviewDisposition = "direct_review" | "direct_reject" | "preview_required" | "invalid";

export function classifyLegacyReviewAction(action: unknown): LegacyReviewDisposition {
  if (action === "review") return "direct_review";
  if (action === "reject") return "direct_reject";
  if (action === "approve") return "preview_required";
  return "invalid";
}
