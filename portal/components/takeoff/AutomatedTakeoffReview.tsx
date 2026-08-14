"use client";

import AIAccuracyNotice from "@/components/common/AIAccuracyNotice";

interface ReviewCandidate {
  id: string;
  review_status?: string | null;
  quantity_validation_status?: string | null;
  quantity_validation_reason?: string | null;
  takeoff_job_id?: string | null;
  is_stale?: boolean | null;
}

export default function AutomatedTakeoffReview({ candidates, working = false, onApproveAndImport }: {
  candidates: ReviewCandidate[];
  working?: boolean;
  onApproveAndImport?: () => void;
}) {
  const pending = candidates.filter((candidate) => candidate.review_status === "suggested" || candidate.review_status === "reviewed");
  const conflicted = pending.some((candidate) => candidate.is_stale || candidate.quantity_validation_reason === "stale_revision");
  const ready = pending.filter((candidate) => !candidate.is_stale && candidate.quantity_validation_status === "validated" && candidate.takeoff_job_id);
  const unresolved = pending.length === 0 || ready.length !== pending.length;
  return (
    <section className="rounded-xl border border-white/10 bg-[#0E0F12] p-4" aria-label="Automated takeoff review">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]">Review and approval</p>
      <p className="mt-2 text-xs leading-5 text-white/55">Inspect source sheet, revision, measured or inferred basis, units, formula, confidence, assumptions, and estimate effect before confirming.</p>
      {pending.length > 0 && <p className="mt-3 text-xs font-semibold text-white/75">{pending.length} {pending.length === 1 ? "quantity" : "quantities"} awaiting resolution</p>}
      {conflicted && <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />Conflicted revision</p>}
      <AIAccuracyNotice context="takeoff" className="mt-3 rounded-lg" />
      <button type="button" onClick={onApproveAndImport} disabled={unresolved || working} className="mt-3 h-9 rounded-full bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black disabled:cursor-not-allowed disabled:opacity-35">{working ? "Approving…" : "Approve and import"}</button>
      {unresolved && <p className="mt-2 text-[10px] text-amber-200/60">Approval remains locked until revision, scale, unit, quantity, permission, and preview checks pass.</p>}
    </section>
  );
}
