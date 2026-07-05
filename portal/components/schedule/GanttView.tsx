"use client";

type TaskStatus = "not_started" | "in_progress" | "complete" | "blocked";

interface GanttTask {
  id: string;
  name: string;
  status: TaskStatus;
  start_date: string | null;
  end_date: string | null;
  critical: boolean;
}

const DAY = 86400000;

const BAR_COLOR: Record<TaskStatus, string> = {
  not_started: "bg-white/15",
  in_progress: "bg-[#00D2FF]",
  complete:    "bg-[#CCFF00]",
  blocked:     "bg-[#E50914]",
};

function parse(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d + "T00:00:00").getTime();
  return Number.isNaN(t) ? null : t;
}

function monthTicks(start: number, end: number): { label: string; pct: number }[] {
  const ticks: { label: string; pct: number }[] = [];
  const span = end - start || 1;
  const d = new Date(start);
  d.setDate(1);
  if (d.getTime() < start) d.setMonth(d.getMonth() + 1);
  let guard = 0;
  while (d.getTime() <= end && guard < 60) {
    ticks.push({
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      pct: ((d.getTime() - start) / span) * 100,
    });
    d.setMonth(d.getMonth() + 1);
    guard++;
  }
  return ticks;
}

export default function GanttView({ tasks }: { tasks: GanttTask[] }) {
  const scheduled = tasks
    .map((t) => ({ ...t, s: parse(t.start_date), e: parse(t.end_date) }))
    .filter((t) => t.s !== null && t.e !== null && (t.e as number) >= (t.s as number)) as
    (GanttTask & { s: number; e: number })[];

  if (scheduled.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#16161A]/40 py-16 text-center">
        <span className="text-xs uppercase tracking-widest text-gray-600">
          No tasks with start &amp; end dates to chart
        </span>
      </div>
    );
  }

  const minStart = Math.min(...scheduled.map((t) => t.s));
  const maxEnd = Math.max(...scheduled.map((t) => t.e));
  const span = maxEnd - minStart || DAY;
  const ticks = monthTicks(minStart, maxEnd);

  // today marker (if within range)
  const now = Date.now();
  const todayPct = now >= minStart && now <= maxEnd ? ((now - minStart) / span) * 100 : null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#16161A] overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Month header */}
          <div className="relative h-8 border-b border-white/10 bg-[#0A0A0B] ml-56">
            {ticks.map((t, i) => (
              <div key={i} className="absolute top-0 h-full flex items-center" style={{ left: `${t.pct}%` }}>
                <span className="text-[9px] text-gray-600 font-mono uppercase tracking-widest border-l border-white/10 pl-1 h-full flex items-center">{t.label}</span>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative divide-y divide-white/5">
            {todayPct !== null && (
              <div className="absolute top-0 bottom-0 w-px bg-[#CCFF00]/40 z-10" style={{ left: `calc(14rem + ${todayPct}% * (100% - 14rem) / 100)` }} />
            )}
            {scheduled.map((t) => {
              const leftPct = ((t.s - minStart) / span) * 100;
              const widthPct = Math.max(((t.e - t.s) / span) * 100, 1.2);
              const days = Math.round((t.e - t.s) / DAY);
              return (
                <div key={t.id} className="flex items-center h-9 hover:bg-white/[0.02] transition-colors">
                  <div className="w-56 shrink-0 px-4 truncate flex items-center gap-1.5">
                    {t.critical && <span className="w-1.5 h-1.5 rounded-full bg-[#E50914] shrink-0" title="Critical path" />}
                    <span className="text-xs text-white truncate">{t.name}</span>
                  </div>
                  <div className="relative flex-1 h-full">
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-3.5 rounded ${t.critical ? "bg-[#E50914]" : BAR_COLOR[t.status]} ${t.critical ? "" : "opacity-90"}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`${t.name} — ${days}d`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-white/10 text-[10px] text-gray-500">
        {([["complete", "Complete"], ["in_progress", "In Progress"], ["not_started", "Not Started"], ["blocked", "Blocked"]] as [TaskStatus, string][]).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`w-3 h-2 rounded-sm ${BAR_COLOR[k]}`} />{label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#E50914]" />Critical path</span>
        <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-[#CCFF00]/60" />Today</span>
      </div>
    </div>
  );
}
