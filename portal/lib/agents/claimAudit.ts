/**
 * Claim a pending agent review before any estimate, RFI, or log write.
 * Two approvers otherwise both pass the status read and insert the same lines.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export type AuditDecision = "approve" | "reject" | "modify";

export type AuditClaimStatus = "rejected" | "approved" | "approved_with_modifications";

export function auditStatusForDecision(decision: AuditDecision): AuditClaimStatus {
  switch (decision) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "modify":
      return "approved_with_modifications";
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

export interface ClaimPendingReviewArgs {
  id: string;
  tenantId: string;
  userId: string;
  status: AuditClaimStatus;
  appliedResult?: Record<string, unknown>;
}

export type ClaimPendingReviewResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; message: string };

export async function claimPendingReview(
  db: AnyDb,
  args: ClaimPendingReviewArgs,
): Promise<ClaimPendingReviewResult> {
  const patch: Record<string, unknown> = {
    status: args.status,
    reviewed_by: args.userId,
    reviewed_at: new Date().toISOString(),
  };
  if (args.appliedResult) patch.applied_result = args.appliedResult;

  const { data, error } = await db
    .from("ai_agent_audit_trails")
    .update(patch)
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .eq("status", "pending_human_review")
    .select("id");
  if (error) return { ok: false, conflict: false, message: error.message ?? "claim failed" };
  if (!data?.length) return { ok: false, conflict: true };
  return { ok: true };
}

/** Put a claimed review back on the queue when the follow-up write did not land. */
export async function releaseAuditClaim(
  db: AnyDb,
  args: { id: string; tenantId: string; status: AuditClaimStatus },
): Promise<void> {
  const { error } = await db
    .from("ai_agent_audit_trails")
    .update({
      status: "pending_human_review",
      reviewed_by: null,
      reviewed_at: null,
      applied_result: null,
    })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .eq("status", args.status)
    .select("id");
  if (error) console.error("[releaseAuditClaim]", error.message);
}
