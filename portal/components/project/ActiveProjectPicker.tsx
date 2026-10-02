"use client";

import Link from "next/link";
import { FolderKanban, ChevronRight } from "lucide-react";
import { useProjectContext } from "./ProjectContext";

export default function ActiveProjectPicker({ onNavigate }: { onNavigate?: () => void }) {
  const { projects, activeProjectId, activeProject, setActiveProjectId, loading } = useProjectContext();

  return (
    <div className="mx-3 mb-4 rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.22em] text-white/30">
        Active project
      </p>

      {loading && projects.length === 0 ? (
        <div className="h-9 animate-pulse rounded-lg bg-white/5" />
      ) : projects.length === 0 ? (
        <Link
          href="/dashboard/projects"
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
            <Link
              href={`/dashboard/projects/${activeProject.id}`}
              onClick={onNavigate}
              className="mt-2 flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-[11px] text-white/45 transition-colors hover:text-[#CCFF00]"
            >
              <span className="truncate">Open workspace</span>
              <ChevronRight size={12} className="shrink-0" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}
