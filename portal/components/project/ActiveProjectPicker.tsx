"use client";

import Link from "next/link";
import { FolderKanban, ChevronRight } from "lucide-react";
import { useProjectContext } from "./ProjectContext";

const QUICK_JUMPS = [
  { label: "Overview", phase: "overview", tab: "summary" },
  { label: "Docs", phase: "documents", tab: "documents" },
  { label: "Takeoff", phase: "takeoff", tab: "takeoff" },
  { label: "Estimate", phase: "estimate", tab: "estimates" },
  { label: "Schedule", phase: "schedule", tab: "scheduling" },
  { label: "Controls", phase: "controls", tab: "controls" },
  { label: "Procurement", phase: "procurement", tab: "procurement" },
  { label: "Financials", phase: "financials", tab: "ar" },
  { label: "Field", phase: "field", tab: "daily-log" },
  { label: "Closeout", phase: "closeout", tab: "punchlist" },
] as const;

export default function ActiveProjectPicker({ onNavigate }: { onNavigate?: () => void }) {
  const { projects, activeProjectId, activeProject, setActiveProjectId, loading } = useProjectContext();

  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.22em] text-white/30">
        Working on
      </p>
      <p className="mb-2 text-[10px] leading-snug text-white/35">
        Work happens inside a project.
      </p>

      {loading && projects.length === 0 ? (
        <div className="h-9 animate-pulse rounded-lg bg-white/5" />
      ) : projects.length === 0 ? (
        <Link
          href="/dashboard/projects?new=1"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg border border-[#CCFF00]/25 bg-[#CCFF00]/10 px-3 py-2 text-xs font-semibold text-[#CCFF00] transition-opacity hover:opacity-85"
        >
          <FolderKanban size={13} />
          Create a project
        </Link>
      ) : (
        <>
          <select
            id="active-project-picker"
            aria-label="Active project"
            value={activeProjectId ?? ""}
            onChange={(e) => setActiveProjectId(e.target.value || null)}
            className="h-9 w-full rounded-lg border border-white/10 bg-[#0E0F12] px-2 text-xs text-white outline-none focus:border-[#CCFF00]/50"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {activeProject && (
            <>
              <Link
                href={`/dashboard/projects/${activeProject.id}`}
                onClick={onNavigate}
                className="mt-2 flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-[11px] font-medium text-[#CCFF00]/90 transition-colors hover:text-[#CCFF00]"
              >
                <span className="truncate">Open workspace</span>
                <ChevronRight size={12} className="shrink-0" />
              </Link>
              <div className="mt-1 flex flex-wrap gap-1">
                {QUICK_JUMPS.filter((jump) =>
                  ["overview", "documents", "takeoff", "estimate"].includes(jump.phase),
                ).map((jump) => (
                  <Link
                    key={jump.phase}
                    href={`/dashboard/projects/${activeProject.id}?phase=${jump.phase}&tab=${jump.tab}`}
                    onClick={onNavigate}
                    className="rounded-md border border-white/8 bg-white/[0.02] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/40 transition-colors hover:border-white/15 hover:text-white/70"
                  >
                    {jump.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
