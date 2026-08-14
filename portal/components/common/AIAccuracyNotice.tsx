import { TriangleAlert } from "lucide-react";

interface AIAccuracyNoticeProps {
  context?: "general" | "takeoff" | "pricing";
  className?: string;
}

const copy = {
  general: "AI can make mistakes. Verify important outputs against current project documents and qualified professional judgment before relying on them.",
  takeoff: "AI can make mistakes and can miss, duplicate, or misclassify scope and quantities. Verify measurements, drawing revisions, specifications, assumptions, and exclusions before approving or pricing the takeoff.",
  pricing: "AI and benchmark pricing can be incomplete, stale, or wrong. Verify quantities and rates with current project documents, local supplier and subcontractor quotes, company actuals, and qualified estimator review before bidding, contracting, purchasing, or forecasting.",
} as const;

export default function AIAccuracyNotice({ context = "general", className = "" }: AIAccuracyNoticeProps) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-100/75 ${className}`}
    >
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />
      <p><span className="font-semibold text-amber-300">AI accuracy notice:</span> {copy[context]}</p>
    </div>
  );
}
