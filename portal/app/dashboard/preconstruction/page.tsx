"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FilePlus2, RefreshCw, Target, Trash2 } from "lucide-react";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useConfirm } from "@/components/common/ConfirmDialog";
import PageHero from "@/components/layout/PageHero";

type Stage = "lead" | "qualifying" | "bidding" | "submitted" | "shortlisted" | "won" | "lost" | "no_bid";
type Priority = "low" | "medium" | "high" | "critical";

interface Opportunity {
  id: string;
  name: string;
  client_name: string | null;
  source: string | null;
  stage: Stage;
  priority: Priority;
  bid_due_date: string | null;
  estimated_value: number | string | null;
  win_probability: number | string | null;
  location: string | null;
  scope_summary: string | null;
  next_action: string | null;
  owner: string | null;
  notes: string | null;
  linked_project_id: string | null;
  updated_at: string;
  projects?: { id: string; name: string; status: string | null } | null;
}

interface OpportunitiesResponse {
  opportunities?: Opportunity[];
  error?: string;
}

const STAGES: { value: Stage; label: string; style: string }[] = [
  { value: "lead", label: "Lead", style: "border-white/10 bg-white/[0.04] text-white/55" },
  { value: "qualifying", label: "Qualifying", style: "border-[#00D2FF]/20 bg-[#00D2FF]/10 text-[#00D2FF]" },
  { value: "bidding", label: "Bidding", style: "border-[#CCFF00]/20 bg-[#CCFF00]/10 text-[#CCFF00]" },
  { value: "submitted", label: "Submitted", style: "border-[#F5A623]/20 bg-[#F5A623]/10 text-[#F5A623]" },
  { value: "shortlisted", label: "Shortlisted", style: "border-purple-400/20 bg-purple-400/10 text-purple-300" },
  { value: "won", label: "Won", style: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
  { value: "lost", label: "Lost", style: "border-white/10 bg-white/[0.03] text-white/35" },
  { value: "no_bid", label: "No Bid", style: "border-white/10 bg-white/[0.03] text-white/35" },
];

const ACTIVE_STAGES = new Set<Stage>(["lead", "qualifying", "bidding", "submitted", "shortlisted"]);

const initialForm = {
  name: "",
  client_name: "",
  source: "",
  stage: "lead" as Stage,
  priority: "medium" as Priority,
  bid_due_date: "",
  estimated_value: "",
  win_probability: "25",
  location: "",
  scope_summary: "",
  next_action: "",
  owner: "",
  notes: "",
};

function toNumber(value: number | string | null | undefined): number {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function stageMeta(stage: Stage) {
  return STAGES.find((item) => item.value === stage) ?? STAGES[0];
}

function dueWithin(value: string | null, days: number): boolean {
  if (!value) return false;
  const due = new Date(`${value}T00:00:00`).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return due >= now.getTime() && due <= now.getTime() + days * 24 * 60 * 60 * 1000;
}

function parseOpportunityBrief(input: string): Partial<typeof initialForm> {
  const text = input.trim();
  const normalized = text.toLowerCase();
  const nameMatch =
    text.match(/(?:called|named)\s+["'â€œâ€]?([^,"'\n]+)["'â€œâ€]?/i) ??
    text.match(/(?:opportunity(?:\s+for)?|bid(?:\s+for)?|pursuit(?:\s+for)?|for)\s+["'â€œâ€]?([^,"'\n]+)["'â€œâ€]?/i);
  const clientMatch = text.match(/(?:client|for)\s+["'â€œâ€]?([^,"'\n]+)["'â€œâ€]?/i);
  const locationMatch = text.match(/\bin\s+([^,.;\n]+?)(?:\s+(?:with|at|on|for)\b|[.,;]|$)/i);
  const dateMatch = text.match(/\b(?:due|bid due|bidding on|submit by|deadline)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i);
  const valueMatch = text.match(/\$([\d,]+(?:\.\d+)?)|\b(?:value|budget|est(?:imated)?(?: value)?)\s+([\d,]+(?:\.\d+)?)\b/i);
  const winMatch = text.match(/\b(\d{1,3})\s*%?\s*(?:win|probability|chance)\b/i);

  const name = nameMatch?.[1]?.trim() ?? text.replace(/^(create|new|add|spin up)\s+(?:bid\s+)?(?:opportunity|pursuit)\s*/i, "").trim();
  const cleanName = name && name.length >= 3 ? name.slice(0, 120) : "Untitled Opportunity";
  const location = locationMatch?.[1]?.trim() ?? "";
  const [city, state] = location.includes(",") ? location.split(",", 2).map((part) => part.trim()) : location ? [location, ""] : ["", ""];

  return {
    name: cleanName,
    client_name: clientMatch?.[1]?.trim() ?? "",
    source: normalized.includes("invite") ? "invitation to bid" : normalized.includes("lead") ? "lead" : "",
    bid_due_date: dateMatch?.[1] ?? "",
    estimated_value: valueMatch?.[1] ?? valueMatch?.[2] ?? "",
    win_probability: winMatch?.[1] ?? "25",
    location: city ? (state ? `${city}, ${state}` : city) : "",
    scope_summary: text,
    next_action: "Review the documents and decide whether to pursue it",
    owner: "",
    notes: "",
  };
}

export default function PreconstructionPage() {
  const { confirm } = useConfirm();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [form, setForm] = useState(initialForm);
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [search, setSearch] = useState("");
  const [codexBrief, setCodexBrief] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (stageFilter !== "all") params.set("stage", stageFilter);
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/preconstruction/opportunities?${params}`, { cache: "no-store" });
      const json = await res.json() as OpportunitiesResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not load opportunities. Refresh the page and try again.");
      setOpportunities(json.opportunities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [stageFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => {
    const active = opportunities.filter((item) => ACTIVE_STAGES.has(item.stage));
    const pipeline = active.reduce((sum, item) => sum + toNumber(item.estimated_value), 0);
    const weighted = active.reduce((sum, item) => sum + toNumber(item.estimated_value) * (toNumber(item.win_probability) / 100), 0);
    const dueSoon = active.filter((item) => dueWithin(item.bid_due_date, 14)).length;
    const won = opportunities.filter((item) => item.stage === "won").length;
    return { active: active.length, pipeline, weighted, dueSoon, won };
  }, [opportunities]);

  const stageCounts = useMemo(() => {
    const counts = new Map<Stage, number>();
    for (const stage of STAGES) counts.set(stage.value, 0);
    for (const item of opportunities) counts.set(item.stage, (counts.get(item.stage) ?? 0) + 1);
    return counts;
  }, [opportunities]);

  const createOpportunity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/preconstruction/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json() as { opportunity?: Opportunity; error?: string };
      if (!res.ok || !json.opportunity) throw new Error(json.error ?? "Could not create opportunity. Check the form and try again.");
      setOpportunities((current) => [json.opportunity!, ...current]);
      setForm(initialForm);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateStage = async (id: string, stage: Stage) => {
    const previous = opportunities;
    setOpportunities((current) => current.map((item) => (item.id === id ? { ...item, stage } : item)));
    try {
      const res = await fetch(`/api/preconstruction/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const json = await res.json() as { opportunity?: Opportunity; error?: string };
      if (!res.ok || !json.opportunity) throw new Error(json.error ?? "Could not update that opportunity. Refresh the page and try again.");
      setOpportunities((current) => current.map((item) => (item.id === id ? json.opportunity! : item)));
    } catch (e) {
      setOpportunities(previous);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeOpportunity = async (id: string) => {
    if (!(await confirm({ title: "Delete this opportunity?", description: "This removes the opportunity from preconstruction." , destructive: true }))) return;
    const previous = opportunities;
    setOpportunities((current) => current.filter((item) => item.id !== id));
    try {
      const res = await fetch(`/api/preconstruction/opportunities/${id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not delete that opportunity. Refresh the page and try again.");
    } catch (e) {
      setOpportunities(previous);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createFromBrief = async () => {
    const brief = codexBrief.trim();
    if (!brief || codexBusy) return;
    setCodexBusy(true);
    setError(null);
    try {
      const nextForm = {
        ...initialForm,
        ...parseOpportunityBrief(brief),
      };
      const res = await fetch("/api/preconstruction/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextForm),
      });
      const json = await res.json() as { opportunity?: Opportunity; error?: string };
      if (!res.ok || !json.opportunity) throw new Error(json.error ?? "Could not create opportunity. Check the brief and try again.");
      setOpportunities((current) => [json.opportunity!, ...current]);
      setCodexBrief("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCodexBusy(false);
    }
  };

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Preconstruction"
        description="Track every opportunity from first lead to award, with value, dates, and next steps."
        compact
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/70 hover:bg-white/[0.06]"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        }
      />

      <main className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Active Pursuits" value={String(summary.active)} loading={loading} sub="Open opportunities" />
          <Metric label="Total Value" value={money(summary.pipeline)} loading={loading} sub="Before weighting" />
          <Metric label="Weighted Value" value={money(summary.weighted)} loading={loading} sub="Value x probability" />
          <Metric label="Due Soon" value={String(summary.dueSoon)} loading={loading} sub="Next 14 days" tone={summary.dueSoon > 0 ? "warn" : "normal"} />
          <Metric label="Won" value={String(summary.won)} loading={loading} sub="Awarded opportunities" />
        </section>

        <section className="mb-6 grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {STAGES.map((stage) => (
            <button
              key={stage.value}
              type="button"
              onClick={() => setStageFilter(stageFilter === stage.value ? "all" : stage.value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${stageFilter === stage.value ? stage.style : "border-white/8 bg-white/[0.025] text-white/45 hover:bg-white/[0.04]"}`}
            >
              <span className="block text-[10px] font-bold uppercase tracking-widest">{stage.label}</span>
              <span className="mt-1 block font-mono text-lg text-white">{stageCounts.get(stage.value) ?? 0}</span>
            </button>
          ))}
        </section>

        <section className="mb-8 rounded-xl border border-white/8 bg-[#0E0F12] p-4">
          <div className="mb-4 flex items-center gap-2">
            <FilePlus2 size={15} className="text-[#CCFF00]" />
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Add Opportunity</h2>
          </div>
          <div className="mb-4 rounded-lg border border-white/8 bg-white/[0.02] p-3 text-[11px] text-white/55">
            Start with the notes box if you have an email, note, or text from a GC. Paste the rough info, create the opportunity, then fill in the details below.
          </div>
          <div className="mb-4 rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Start from notes</p>
              <button
                type="button"
                onClick={() => void createFromBrief()}
                disabled={codexBusy || !codexBrief.trim()}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Target size={12} /> {codexBusy ? "Creating..." : "Fill form"}
              </button>
            </div>
            <textarea
              value={codexBrief}
              onChange={(event) => setCodexBrief(event.target.value)}
              placeholder="Paste a quick draft like: Create an opportunity for the Southgate warehouse TI in Dallas due 2026-08-18, estimated value 1.2M, client Northstar, 35% chance to win."
              className="min-h-[88px] w-full rounded-lg border border-white/10 bg-[#090A0C] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
            />
            <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/30">
              Tip: include project, client, due date, value, and location if you know them.
            </p>
          </div>
          <form onSubmit={createOpportunity} className="grid gap-3 lg:grid-cols-6">
            <Input label="Opportunity" value={form.name} required onChange={(value) => setForm((current) => ({ ...current, name: value }))} className="lg:col-span-2" />
            <Input label="Client" value={form.client_name} onChange={(value) => setForm((current) => ({ ...current, client_name: value }))} />
            <Input label="Due Date" value={form.bid_due_date} type="date" onChange={(value) => setForm((current) => ({ ...current, bid_due_date: value }))} />
            <Input label="Est. Value" value={form.estimated_value} type="number" onChange={(value) => setForm((current) => ({ ...current, estimated_value: value }))} />
            <Input label="Chance to Win (%)" value={form.win_probability} type="number" onChange={(value) => setForm((current) => ({ ...current, win_probability: value }))} />
            <Select label="Stage" value={form.stage} onChange={(value) => setForm((current) => ({ ...current, stage: value as Stage }))} options={STAGES.map((stage) => [stage.value, stage.label])} />
            <Select
              label="Priority"
              value={form.priority}
              onChange={(value) => setForm((current) => ({ ...current, priority: value as Priority }))}
              options={[["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]]}
            />
            <Input label="Owner" value={form.owner} onChange={(value) => setForm((current) => ({ ...current, owner: value }))} />
            <Input label="Source" value={form.source} onChange={(value) => setForm((current) => ({ ...current, source: value }))} />
            <Input label="Location" value={form.location} onChange={(value) => setForm((current) => ({ ...current, location: value }))} className="lg:col-span-2" />
            <Input label="Next Action" value={form.next_action} onChange={(value) => setForm((current) => ({ ...current, next_action: value }))} className="lg:col-span-3" />
            <Input label="Scope Summary" value={form.scope_summary} onChange={(value) => setForm((current) => ({ ...current, scope_summary: value }))} className="lg:col-span-3" />
            <div className="lg:col-span-6 rounded-lg border border-white/8 bg-white/[0.02] p-3 text-[11px] text-white/45">
              Use stage to show where the opportunity stands, and keep next action short enough that the team can act on it at a glance.
            </div>
            <div className="flex items-end lg:col-span-6">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Target size={14} /> {saving ? "Saving" : "Add Opportunity"}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-xl border border-white/8 bg-[#0E0F12]">
          <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Opportunity Pipeline</h2>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, client, or location"
              className="h-9 w-full rounded-lg border border-white/10 bg-[#090A0C] px-3 text-xs text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50 sm:w-64"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-white/10 bg-[#0A0A0B]">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Pursuit</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Stage</th>
                  <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-gray-600">Value</th>
                  <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-gray-600">Win</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Due Date</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Next Action</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Linked Project</th>
                  <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  [...Array(5)].map((_, index) => (
                    <tr key={index}><td colSpan={8} className="px-4 py-3"><div className="h-3 w-2/3 animate-pulse rounded bg-white/5" /></td></tr>
                  ))
                ) : opportunities.length === 0 && !error ? (
                  <tr>
                    <td colSpan={8}>
              <EmptyState
                icon={<CalendarClock className="h-6 w-6" />}
                title="No opportunities yet"
                description="Add the first opportunity to start tracking pre-award work."
                actionLabel="Create opportunity"
                actionHref="/dashboard/preconstruction"
                secondaryLabel="Open projects"
                secondaryHref="/dashboard/projects"
              />
                    </td>
                  </tr>
                ) : (
                  opportunities.map((item) => {
                    const meta = stageMeta(item.stage);
                    const value = toNumber(item.estimated_value);
                    return (
                      <tr key={item.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="max-w-sm px-4 py-3">
                          <p className="line-clamp-2 text-xs font-semibold text-white">{item.name}</p>
                          <p className="mt-1 text-[11px] text-white/35">{item.client_name ?? "-"}{item.location ? ` / ${item.location}` : ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={item.stage}
                            onChange={(event) => void updateStage(item.id, event.target.value as Stage)}
                            className={`h-8 rounded border px-2 text-[10px] font-bold uppercase tracking-widest outline-none ${meta.style}`}
                          >
                            {STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-white/70">{money(value)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-white/70">{Math.round(toNumber(item.win_probability))}%</td>
                        <td className={`px-4 py-3 text-xs ${dueWithin(item.bid_due_date, 14) ? "text-[#F5A623]" : "text-white/45"}`}>{fmtDate(item.bid_due_date)}</td>
                        <td className="max-w-xs px-4 py-3 text-xs text-white/45">{item.next_action ?? item.owner ?? "-"}</td>
                        <td className="px-4 py-3 text-xs text-white/45">
                          {item.projects ? (
                            <Link className="hover:text-[#CCFF00]" href={`/dashboard/projects/${item.projects.id}`}>{item.projects.name}</Link>
                          ) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void removeOpportunity(item.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/35 hover:bg-white/[0.04] hover:text-white"
                            aria-label={`Delete ${item.name}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, sub, loading, tone = "normal" }: { label: string; value: string; sub: string; loading: boolean; tone?: "normal" | "warn" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "warn" ? "border-[#F5A623]/25 bg-[#F5A623]/[0.04]" : "border-white/8 bg-[#111113]"}`}>
      {loading ? <div className="h-7 w-20 animate-pulse rounded bg-white/5" /> : <p className={`text-2xl font-black leading-none ${tone === "warn" ? "text-[#F5A623]" : "text-white"}`}>{value}</p>}
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">{label}</p>
      <p className="mt-1 text-[11px] text-white/35">{sub}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  className = "",
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-white/10 bg-[#090A0C] px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-white/10 bg-[#090A0C] px-3 text-sm text-white outline-none focus:border-[#CCFF00]/50"
      >
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  );
}
