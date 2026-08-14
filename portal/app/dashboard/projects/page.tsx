"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  DollarSign,
  MapPin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Tables } from "@/lib/supabase/types";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";

type Project = Tables<"projects">;

interface NewProjectForm {
  name: string;
  address: string;
  city: string;
  state: string;
  status: string;
  budget: string;
}

const EMPTY_FORM: NewProjectForm = {
  name: "",
  address: "",
  city: "",
  state: "",
  status: "active",
  budget: "",
};

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
  if (value == null) return "-";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function parseProjectBrief(input: string): NewProjectForm {
  const text = input.trim();
  const nameMatch =
    text.match(/(?:called|named)\s+["']?([^,"'\n]+)["']?/i) ??
    text.match(/(?:project(?:\s+for)?|job(?:\s+for)?|build(?:\s+for)?|for)\s+["']?([^,"'\n]+)["']?/i);
  const addressMatch = text.match(/\b(?:at|address(?:ed)? at|located at)\s+([^,.;\n]+(?:\s*,\s*[^,.;\n]+)?)/i);
  const cityStateMatch = text.match(/\bin\s+([^,.;\n]+?)(?:\s+\b(?:with|for|at|on|budget|status|due)\b|[.;]|$)/i);
  const budgetMatch = text.match(/\$([\d,]+(?:\.\d+)?)|\b(?:budget|value|estimate|est(?:imated)? value)\s+([\d,]+(?:\.\d+)?)\b/i);

  const rawName = nameMatch?.[1]?.trim() ?? text.replace(/^(create|new|start|add|spin up)\s+project\s*/i, "").trim();
  const [city, state] = cityStateMatch?.[1]
    ? cityStateMatch[1].includes(",")
      ? cityStateMatch[1].split(",", 2).map((part) => part.trim())
      : [cityStateMatch[1].trim(), ""]
    : ["", ""];

  return {
    name: rawName && rawName.length >= 3 ? rawName.slice(0, 120) : "Untitled Project",
    address: addressMatch?.[1]?.trim().slice(0, 120) ?? "",
    city,
    state,
    status: text.toLowerCase().includes("bid") ? "bidding" : text.toLowerCase().includes("hold") ? "on_hold" : "active",
    budget: budgetMatch?.[1] ?? budgetMatch?.[2] ?? "",
  };
}
function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: () => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const location = [project.city, project.state].filter(Boolean).join(", ");
  const created = new Date(project.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!(await confirm({ title: "Delete this project? This cannot be undone.", destructive: true }))) return;
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
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClasses(project.status)}`}
          aria-label={`Status: ${statusLabel(project.status)}`}
        >
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, budget: form.budget ? parseFloat(form.budget) : null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadProjects();
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createFromBrief() {
    const text = brief.trim();
    if (!text) return;
    setForm(parseProjectBrief(text));
    setShowForm(true);
  }

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Projects"
        description={loading ? "Loading projects..." : `${projects.length} project${projects.length !== 1 ? "s" : ""} in the workspace`}
        compact
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            <Plus size={14} /> New project
          </button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && (
          <div className="mb-6">
            <ErrorState message={error} onRetry={loadProjects} />
          </div>
        )}

        <section className="mb-8 rounded-xl border border-white/8 bg-[#111113] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Quick start</p>
              <p className="text-[11px] text-white/40">
                Describe the project in plain language and let the form fill the new project for you.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void createFromBrief()}
              disabled={!brief.trim()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Fill form
            </button>
          </div>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Example: Create a new project called Southgate Warehouse TI in Dallas, TX with a budget of 1.2M and bidding status."
            className="min-h-[92px] w-full rounded-lg border border-white/10 bg-[#0A0A0B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
          />
        </section>

        {showForm && (
          <div className="mb-8 rounded-xl border border-white/10 bg-[#111113] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold text-white">New Project</h2>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                }}
                className="rounded-md p-1 text-white/30 transition-colors hover:text-white min-h-[40px]"
                aria-label="Close new project form"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(
                  [
                    { key: "name", label: "Project Name *", placeholder: "Main Street Office Build-Out" },
                    { key: "address", label: "Address", placeholder: "123 Main St" },
                    { key: "city", label: "City", placeholder: "Dallas" },
                    { key: "state", label: "State", placeholder: "TX" },
                    { key: "budget", label: "Budget ($)", placeholder: "0.00" },
                  ] as { key: keyof NewProjectForm; label: string; placeholder: string }[]
                ).map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      {label}
                    </label>
                    <input
                      type={key === "budget" ? "number" : "text"}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      required={key === "name"}
                      className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/40"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-white/40">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-[#111113] px-3 text-sm text-white outline-none focus:border-[#CCFF00]/40"
                  >
                    <option value="active">Active</option>
                    <option value="bidding">Bidding</option>
                    <option value="on_hold">On Hold</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#CCFF00] px-4 text-sm font-bold text-black disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Project"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setForm(EMPTY_FORM);
                  }}
                  className="h-9 rounded-lg px-4 text-sm text-white/40 transition-colors hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

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
                description="Create your first project or use the quick start box above, then use it as the home base for documents, takeoff, estimates, and billing."
                actionLabel="Create project"
                onAction={() => setShowForm(true)}
                secondaryLabel="Open documents"
                secondaryHref="/dashboard/documents"
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
