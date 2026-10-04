"use client";

export interface ProcessingEventRow {
  id: string;
  step: string;
  status: string;
  worker: string | null;
  attempt_number: number;
  error_message: string | null;
  page_number: number | null;
  started_at: string;
  completed_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  started: "text-[#00D2FF]",
  succeeded: "text-[#CCFF00]",
  failed: "text-[#E50914]",
  skipped: "text-gray-500",
};

export function ProcessingTimeline({
  events,
  loading,
  error,
}: {
  events: ProcessingEventRow[];
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-6 bg-white/5 animate-pulse rounded" />
        ))}
      </div>
    );
  }
  if (error) {
    return <p className="text-[11px] text-[#E50914]">Could not load timeline: {error}</p>;
  }
  if (events.length === 0) {
    return (
      <p className="text-[11px] text-gray-600 uppercase tracking-widest">
        No processing events recorded yet.
      </p>
    );
  }

  return (
    <ol className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex items-start gap-2 rounded border border-white/5 bg-[#0E0F12] px-2.5 py-1.5"
        >
          <span className={`mt-0.5 text-[9px] uppercase tracking-widest font-bold shrink-0 ${STATUS_COLOR[e.status] ?? "text-gray-500"}`}>
            {e.status}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-white/80 font-mono truncate">
              {e.step}
              {e.page_number != null ? ` · p${e.page_number}` : ""}
              {e.worker ? ` · ${e.worker}` : ""}
            </p>
            {e.error_message && (
              <p className="mt-0.5 text-[10px] text-[#E50914]/80 truncate" title={e.error_message}>
                {e.error_message}
              </p>
            )}
          </div>
          <time className="text-[9px] text-gray-600 font-mono shrink-0">
            {new Date(e.started_at).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
