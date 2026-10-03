export type PipelineStatus =
  | "pending"
  | "processing"
  | "done"
  | "error"
  | "partially_completed"
  | "skipped";

const PIPELINE_DOT: Record<PipelineStatus, string> = {
  pending: "bg-white/15",
  processing: "bg-[#00D2FF] animate-pulse",
  done: "bg-[#CCFF00]",
  error: "bg-[#E50914]",
  partially_completed: "bg-[#F5A623]",
  skipped: "bg-white/10",
};

export function PipelineStage({ label, status }: { label: string; status: PipelineStatus | null }) {
  const key = (status ?? "pending") as PipelineStatus;
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${status ?? "pending"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${PIPELINE_DOT[key] ?? "bg-white/15"}`} />
      <span className="text-[9px] uppercase tracking-wider text-white/35">{label}</span>
    </span>
  );
}
