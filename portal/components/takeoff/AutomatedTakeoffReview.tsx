"use client";

import AIAccuracyNotice from "@/components/common/AIAccuracyNotice";

export default function AutomatedTakeoffReview({ unresolved = true }: { unresolved?: boolean }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0E0F12] p-4" aria-label="Automated takeoff review">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]">Review and approval</p>
      <p className="mt-2 text-xs leading-5 text-white/55">Inspect source sheet, revision, measured or inferred basis, units, formula, confidence, assumptions, and estimate effect before confirming.</p>
      <AIAccuracyNotice context="takeoff" className="mt-3 rounded-lg" />
      <button type="button" disabled={unresolved} className="mt-3 h-9 rounded-full bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black disabled:cursor-not-allowed disabled:opacity-35">Approve and import</button>
      {unresolved && <p className="mt-2 text-[10px] text-amber-200/60">Approval remains locked until revision, scale, unit, quantity, permission, and preview checks pass.</p>}
    </section>
  );
}
