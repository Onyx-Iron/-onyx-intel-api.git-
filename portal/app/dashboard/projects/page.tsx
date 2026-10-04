"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  DollarSign,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import type { Tables } from "@/lib/supabase/types";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { useProjectContext } from "@/components/project/ProjectContext";
import NewProjectForm from "@/components/project/NewProjectForm";

type Project = Tables<"projects">;

function statusLabel(status: string): string {
  return { active: "Active", bidding: "Bidding", on_hold: "On Hold", complete: "Complete" }[status] ?? status;
}

function statusClasses(status: string): string {
  return {
    active: "border-[#CCFF00]/30 bg-[#CCFF00]/10 text-[#CCFF00]",
    bidding: "border-[#00D2FF]/30 bg-[#00D2FF]/10 text-[#00D2FF]",
    on_hold: "border-amber-400/30 bg-amber-400/10 text-amber-400",
    complete: "border-white/15 bg-white/5 text-white/50",
  }[status] ?? "border-white/15 bg-white/5 text-white/50";
}

function formatBudget(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: () => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const location = [project.city, project.state].filter(Boolean).join(", ");
  const created = new Date(project.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await confirm({ title: String("Delete this project? This cannot be undone."), destructive: true }))) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onDeleted();
    } catch (err) {
      toast({ title: String(err instanceof Error ? err.message : String(err)), kind: "error" });
    }
  }

  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className="group relative block rounded-xl border border-white/8 bg-[#111113] p-5 transition-colors hover:border-white/20 hover:bg-[#16161A]"
    >
      <button
        type="button"
        onClick={handleDelete}
        aria-label="Delete project"
        className="absolute right-3 top-3 rounded-md p-1 text-white/30 hover:text-red-400 transition-colors min-h-[40px]"
      >
        <Trash2 size={14} />
      </button>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#CCFF00]/8 text-[#CCFF00]">
            <Building2 size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-white transition-colors group-hover:text-[#CCFF00]">
              {project.name}
            </h3>
            {location && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-white/40">
                <MapPin size={10} /> {location}
              </p>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClasses(project.status)}`} aria-label={`Status: ${statusLabel(project.status)}`}>
          {statusLabel(project.status)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/3 px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/30">
            <DollarSign size={9} /> Budget
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {formatBudget(project.budget != null ? Number(project.budget) : null)}
          </p>
        </div>
        <div className="rounded-lg bg-white/3 px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/30">
            <Calendar size={9} /> Created
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white">{created}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end text-xs text-white/25 transition-colors group-hover:text-[#CCFF00]/60">
        Open project <ChevronRight size={13} />
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="px-4 py-10 text-sm text-white/40">Loading projects…</div>}>
      <ProjectsPageInner />
    </Suspense>
  );
}

function ProjectsPageInner() {
  const { refreshProjects } = useProjectContext();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(() => searchParams.get("new") === "1");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setProjects(data.projects ?? []);
      void refreshProjects();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshProjects]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadProjects(); }, [loadProjects]);

  if (searchParams.get("new") === "1" && !showForm) {
    setShowForm(true);
  }

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Projects"
        description={loading ? "Loading…" : `${projects.length} project${projects.length !== 1 ? "s" : ""} in workspace`}
        compact
        actions={
          <button
            id="new-project-button"
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            <Plus size={14} /> New
          </button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">

      {error && <div className="mb-6"><ErrorState message={error} onRetry={loadProjects} /></div>}

      {showForm && (
        <div className="mb-8">
          <NewProjectForm onClose={() => setShowForm(false)} />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-white/5 bg-[#111113]" />
          ))}
        </div>
      ) : projects.length === 0 && !error ? (
        <div className="rounded-xl border border-white/8 bg-[#111113] py-10">
          <EmptyState
            icon={<Briefcase className="w-6 h-6" />}
            title="No projects yet"
            description="Create your first project to start tracking work."
            actionLabel="New Project"
            onAction={() => setShowForm(true)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onDeleted={loadProjects} />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
