"use client";

import { useEffect } from "react";
import { useProjectContext } from "./ProjectContext";

interface Props {
  /** When true, includes an "All projects" option (default true). */
  allowAll?: boolean;
  /** Optional local override callback — still updates the shared active project. */
  className?: string;
  id?: string;
  label?: string;
}

/**
 * Shared project scope control. Changing the value updates the global active
 * project so Takeoff, Estimating, Reports, AI, etc. stay in sync.
 */
export default function ProjectScopeSelect({
  allowAll = true,
  className,
  id = "project-scope-select",
  label = "Project",
}: Props) {
  const { projects, activeProjectId, setActiveProjectId, loading } = useProjectContext();

  // If "all" is not allowed and nothing is selected, pick the first project.
  useEffect(() => {
    if (allowAll) return;
    if (activeProjectId) return;
    if (projects[0]) setActiveProjectId(projects[0].id);
  }, [allowAll, activeProjectId, projects, setActiveProjectId]);

  const value = allowAll ? (activeProjectId ?? "all") : (activeProjectId ?? projects[0]?.id ?? "");

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
          {label}
        </label>
      )}
      <select
        id={id}
        disabled={loading && projects.length === 0}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setActiveProjectId(next === "all" ? null : next || null);
        }}
        className="h-9 w-full min-w-[10rem] rounded-lg border border-white/10 bg-[#0E0F12] px-3 text-xs text-white/80 outline-none focus:border-[#CCFF00]/50"
      >
        {allowAll && <option value="all">All projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Filter helper — returns items for the active project, or all when unset. */
export function filterByActiveProject<T extends { project_id: string | null }>(
  items: T[],
  activeProjectId: string | null,
): T[] {
  if (!activeProjectId) return items;
  return items.filter((i) => i.project_id === activeProjectId);
}
