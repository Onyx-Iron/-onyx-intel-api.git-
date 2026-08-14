"use client";

import React, { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  FolderOpen,
  Layers,
  MessageSquare,
  Plus,
  Send,
  TrendingUp,
  Zap,
} from "lucide-react";
import GoogleConnect from "@/components/google/GoogleConnect";
import GoogleCalendarCard from "@/components/dashboard/GoogleCalendarCard";
import GmailInboxCard from "@/components/dashboard/GmailInboxCard";
import RecentContactsCard from "@/components/dashboard/RecentContactsCard";
import AuditActivityCard from "@/components/dashboard/AuditActivityCard";
import AIProviderPicker from "@/components/ai/AIProviderPicker";
import BrandMark from "@/components/brand/BrandMark";
import GlobalSearch from "@/components/search/GlobalSearch";

interface DashProject {
  id: string;
  name: string;
  location: string;
  status: string;
  completion: number;
  budget: number;
  estimated: number;
  takeoffItems: number;
  documents: number;
  tasks: number;
  start_date: string | null;
  end_date: string | null;
}

interface DashKpis {
  projects: number;
  activeProjects: number;
  takeoffItems: number;
  documents: number;
  scheduleTasks: number;
  estimatedValue: number;
}

interface DashActivity {
  id: string;
  ts: string;
  kind: string;
  project: string;
  message: string;
  detail: string;
}

interface DashData {
  kpis: DashKpis;
  projects: DashProject[];
  activity: DashActivity[];
}

interface AIMessage {
  id: string;
  role: "user" | "system";
  content: string;
  timestamp: string;
}

interface Metric {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: "lime" | "blue" | "amber" | "slate";
}

const INITIAL_AI_MESSAGES: AIMessage[] = [
  {
    id: "msg-001",
    role: "system",
    content:
      "OnyxIntel AI is ready. Ask for a spec summary, draft RFI, quantity check, or schedule risk scan.",
    timestamp: "--",
  },
];

const QUICK_PROMPTS = [
  "Summarize project risks across active jobs.",
  "Draft an RFI from a missing spec detail.",
  "What takeoff items need estimate review?",
];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(value: string | null): string {
  if (!value) return "TBD";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "--";
  }
}

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

function activityTone(kind: string): string {
  return { document: "bg-[#00D2FF]", takeoff: "bg-[#CCFF00]", estimate: "bg-amber-400" }[kind] ?? "bg-white/30";
}

function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-white/8 bg-[#111113] ${className}`}>
      <div className="flex min-h-12 items-center justify-between border-b border-white/8 px-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-white/40">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ProgressBar({ value, tone = "lime" }: { value: number; tone?: "lime" | "blue" | "amber" }) {
  const bar = { lime: "bg-[#CCFF00]", blue: "bg-[#00D2FF]", amber: "bg-amber-400" }[tone];
  return (
    <div className="h-1 overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

function ProjectPipeline({ projects, loading }: { projects: DashProject[]; loading: boolean }) {
  return (
    <Panel
      title="Active Projects"
      className="xl:col-span-2"
      action={
        <Link href="/dashboard/projects" className="inline-flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-[#CCFF00]">
          View all <ChevronRight size={14} />
        </Link>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Project</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Status</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Progress</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Estimate / Budget</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Dates</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Docs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              [...Array(5)].map((_, index) => (
                <tr key={index}>
                  <td className="px-4 py-4" colSpan={6}>
                    <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                  </td>
                </tr>
              ))
            ) : projects.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-white/30" colSpan={6}>
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <p>No projects match the current filters.</p>
                    <p className="text-xs text-white/25">Clear the filters, or create a project to start filling this view.</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Link href="/dashboard/projects" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85">
                        View projects
                      </Link>
                      <Link href="/dashboard/projects" className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white">
                        Create project
                      </Link>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              projects.slice(0, 6).map((project) => {
                const overBudget = project.budget > 0 && project.estimated > project.budget;
                return (
                  <tr key={project.id} className="transition-colors hover:bg-white/3">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/projects/${project.id}`} className="font-semibold text-white transition-colors hover:text-[#CCFF00]">
                        {project.name}
                      </Link>
                  <p className="mt-0.5 text-xs text-white/40">{project.location || "Location not set yet"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClasses(project.status)}`}>
                        {statusLabel(project.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-24">
                          <ProgressBar value={project.completion} tone={project.completion < 35 ? "amber" : "lime"} />
                        </div>
                        <span className="text-xs font-medium text-white/60">{project.completion}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {project.estimated > 0 ? formatCurrency(project.estimated) : <span className="text-white/30">Not priced</span>}
                      </div>
                      <p className={`text-xs ${overBudget ? "text-red-400" : "text-white/30"}`}>
                        {project.budget > 0 ? `${formatCurrency(project.budget)} budget` : "Budget TBD"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40">
                      {formatDate(project.start_date)} — {formatDate(project.end_date)}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      <span className="inline-flex items-center gap-1">
                        <FileText size={13} /> {project.documents}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ScheduleRiskPanel({ projects, loading }: { projects: DashProject[]; loading: boolean }) {
  const ranked = projects.slice().sort((a, b) => a.completion - b.completion).slice(0, 4);

  return (
    <Panel title="Schedule and Risk">
      <div className="divide-y divide-white/5">
        {loading ? (
          [...Array(4)].map((_, index) => (
            <div key={index} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-white/5" />
            </div>
          ))
        ) : ranked.length === 0 ? (
          <div className="px-4 py-8 text-sm text-white/30">Add project dates and tasks to unlock this view.</div>
        ) : (
          ranked.map((project) => (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="block px-4 py-3 transition-colors hover:bg-white/3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{project.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-white/40">
                    <Clock size={12} /> {formatDate(project.end_date)} finish
                  </p>
                </div>
                <span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${project.completion < 35 ? "bg-amber-400/10 text-amber-400" : "bg-[#CCFF00]/10 text-[#CCFF00]"}`}>
                  {project.completion < 35 ? "Review" : "On track"}
                </span>
              </div>
              <div className="mt-3">
                <ProgressBar value={project.completion} tone={project.completion < 35 ? "amber" : "blue"} />
              </div>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

function DocumentIntelligence({ data, loading }: { data: DashData | null; loading: boolean }) {
  const latest = data?.activity.filter((item) => item.kind === "document").slice(0, 4) ?? [];

  return (
    <Panel title="Documents">
      <div className="grid grid-cols-2 border-b border-white/5">
        <div className="border-r border-white/5 p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/40">Documents indexed</p>
          <p className="mt-2 text-2xl font-black text-white">{loading ? "--" : data?.kpis.documents ?? 0}</p>
        </div>
        <div className="p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/40">Takeoff items</p>
          <p className="mt-2 text-2xl font-black text-white">{loading ? "--" : data?.kpis.takeoffItems ?? 0}</p>
        </div>
      </div>
      <div className="divide-y divide-white/5">
        {loading ? (
          [...Array(3)].map((_, index) => (
            <div key={index} className="px-4 py-3">
              <div className="h-4 animate-pulse rounded bg-white/5" />
            </div>
          ))
        ) : latest.length === 0 ? (
          <div className="px-4 py-8 text-sm text-white/30">Upload drawings, specs, or contracts to begin analysis.</div>
        ) : (
          latest.map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-[#00D2FF]/10 text-[#00D2FF]">
                  <FileText size={14} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.detail}</p>
                  <p className="mt-0.5 text-xs text-white/40">{item.project} · {formatTime(item.ts)}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function ActivityFeed({ items, loading }: { items: DashActivity[]; loading: boolean }) {
  return (
    <Panel title="Recent Activity">
      <div className="divide-y divide-white/5">
        {loading ? (
          [...Array(5)].map((_, index) => (
            <div key={index} className="px-4 py-3">
              <div className="h-4 animate-pulse rounded bg-white/5" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-sm text-white/30">Recent activity will appear here as you work.</div>
        ) : (
          items.slice(0, 6).map((item) => (
            <div key={item.id} className="flex gap-3 px-4 py-3">
              <span className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${activityTone(item.kind)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-white">{item.message}</p>
                  <span className="shrink-0 text-xs text-white/30">{formatTime(item.ts)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-white/40">{item.project} · {item.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function AICommandPanel({
  aiInput,
  aiMessages,
  aiLoading,
  setAiInput,
  onSubmit,
  chatEndRef,
}: {
  aiInput: string;
  aiMessages: AIMessage[];
  aiLoading: boolean;
  setAiInput: (value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Panel
      title="Ask AI"
      action={<AIProviderPicker />}
      className="min-h-[520px]"
    >
      <div className="flex h-[460px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {aiMessages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${message.role === "system" ? "bg-[#CCFF00]/10 text-[#CCFF00]" : "bg-white/8 text-white/60"}`}>
                {message.role === "system" ? <Zap size={13} /> : <MessageSquare size={13} />}
              </div>
              <div className={`max-w-[84%] rounded-lg border px-3 py-2 text-sm leading-6 ${message.role === "system" ? "border-white/8 bg-white/3 text-white/80" : "border-[#00D2FF]/20 bg-[#00D2FF]/8 text-white"}`}>
                {message.content}
                <p className="mt-1 text-[10px] text-white/30">{message.timestamp}</p>
              </div>
            </div>
          ))}
          {aiLoading && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#CCFF00]/10 text-[#CCFF00]">
                <Zap size={13} />
              </div>
              <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5">
                <div className="flex gap-1">
                  {[0, 1, 2].map((item) => (
                    <span key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#CCFF00]" style={{ animationDelay: `${item * 140}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-white/8 p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setAiInput(prompt);
                  inputRef.current?.focus();
                }}
                className="rounded-md border border-white/10 bg-white/3 px-2.5 py-1.5 text-xs text-white/50 transition-colors hover:border-white/20 hover:text-white"
              >
                {prompt}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={aiInput}
              onChange={(event) => setAiInput(event.target.value)}
              placeholder="Ask about specs, quantities, RFIs, or schedules"
              className="h-10 min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#CCFF00]/50"
            />
            <button
              type="submit"
              disabled={!aiInput.trim() || aiLoading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#CCFF00] text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Send message"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      </div>
    </Panel>
  );
}

interface OnyxIntelDashboardProps {
  userName?: string;
  previewData?: DashData;
}

export default function OnyxIntelDashboard({ previewData }: OnyxIntelDashboardProps) {
  const [data, setData] = useState<DashData | null>(previewData ?? null);
  const [dataLoading, setDataLoading] = useState(!previewData);
  const [dataError, setDataError] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState("");
  const [aiMessages, setAiMessages] = useState<AIMessage[]>(INITIAL_AI_MESSAGES);
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previewData) return;
    let cancelled = false;

    fetch("/api/dashboard")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body as DashData;
      })
      .then((body) => { if (!cancelled) { setData(body); setDataError(null); } })
      .catch((error: unknown) => { if (!cancelled) setDataError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setDataLoading(false); });

    return () => { cancelled = true; };
  }, [previewData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  const filteredProjects = data?.projects ?? [];

  const pendingTakeoffs = data?.projects.filter((project) => project.takeoffItems === 0).length ?? 0;
  const overBudget = data?.projects.filter((project) => project.budget > 0 && project.estimated > project.budget).length ?? 0;

  const metrics: Metric[] = data ? [
    { label: "Active Projects",  value: String(data.kpis.activeProjects), detail: `${data.kpis.projects} total projects in workspace`, icon: <TrendingUp size={16} />, tone: "lime" },
    { label: "Takeoffs needing work", value: String(pendingTakeoffs), detail: `${data.kpis.takeoffItems} takeoff line items indexed`, icon: <Layers size={16} />, tone: "blue" },
    { label: "Documents",        value: String(data.kpis.documents), detail: "Specs, drawings, photos, and contracts", icon: <FileText size={16} />, tone: "slate" },
    { label: "Estimate Value",   value: formatCurrency(data.kpis.estimatedValue), detail: overBudget > 0 ? `${overBudget} project${overBudget === 1 ? "" : "s"} above budget` : "No budget alerts", icon: <DollarSign size={16} />, tone: overBudget > 0 ? "amber" : "lime" },
  ] : [];

  function buildProjectContext(dashData: DashData): string {
    const lines: string[] = [
      `=== Portfolio Summary (${new Date().toLocaleDateString()}) ===`,
      `Projects: ${dashData.kpis.projects} total, ${dashData.kpis.activeProjects} active`,
      `Total Estimated Value: $${dashData.kpis.estimatedValue.toLocaleString()}`,
      `Documents Indexed: ${dashData.kpis.documents}`,
      `Takeoff Line Items: ${dashData.kpis.takeoffItems}`,
      `Schedule Tasks: ${dashData.kpis.scheduleTasks}`,
      "", "=== Projects ===",
    ];
    for (const p of dashData.projects) {
      const budgetNote = p.budget > 0 ? `Budget $${p.budget.toLocaleString()} / Est $${p.estimated.toLocaleString()}${p.estimated > p.budget ? " ⚠ OVER" : ""}` : `Est $${p.estimated.toLocaleString()}`;
      lines.push(`• ${p.name} | ${p.location} | ${p.status} | ${p.completion}% complete`, `  ${budgetNote} | ${p.documents} docs | ${p.takeoffItems} takeoff items | ${p.tasks} tasks`);
      if (p.start_date || p.end_date) lines.push(`  Dates: ${p.start_date ?? "TBD"} → ${p.end_date ?? "TBD"}`);
    }
    if (dashData.activity.length > 0) {
      lines.push("", "=== Recent Activity ===");
      for (const a of dashData.activity.slice(0, 8)) lines.push(`• [${a.kind}] ${a.project}: ${a.message}`);
    }
    return lines.join("\n");
  }

  async function handleAISubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = aiInput.trim();
    if (!trimmed || aiLoading) return;

    const timestamp = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    setAiMessages((previous) => [
      ...previous,
      { id: `msg-${Date.now()}`, role: "user", content: trimmed, timestamp: timestamp() },
    ]);
    setAiInput("");
    setAiLoading(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assist", assist_mode: "ask", prompt: trimmed, context: data ? buildProjectContext(data) : undefined }),
      });
      const body = (await response.json()) as { text?: string; error?: string; code?: string };
      const content = response.ok
        ? (body.text?.trim() || "(no response)")
        : body.code === "NO_PROVIDER"
          ? "No AI model is connected yet. Open Billing settings, connect a provider, and try again."
          : `Error: ${body.error ?? response.status}. Try again in a moment or add a different AI provider if this keeps happening.`;
      setAiMessages((previous) => [...previous, { id: `msg-${Date.now() + 1}`, role: "system", content, timestamp: timestamp() }]);
    } catch (error) {
      setAiMessages((previous) => [...previous, { id: `msg-${Date.now() + 1}`, role: "system", content: `Request failed: ${error instanceof Error ? error.message : String(error)}. Try again in a moment.`, timestamp: timestamp() }]);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#06070A] text-white">
      {/* HERO — /nk editorial style */}
      <section className="relative overflow-hidden border-b border-white/5">
        {/* Atmospheric gradient — aurora wash, no animation */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 75% 10%, rgba(204,255,0,0.10) 0%, transparent 45%), radial-gradient(90% 70% at 90% 60%, rgba(0,210,180,0.08) 0%, transparent 50%), linear-gradient(180deg, #06070A 0%, #08090C 100%)",
          }}
        />
        {/* Lime monolith */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[8%] top-[18%] hidden h-[62%] w-[6px] origin-bottom -rotate-12 bg-[#CCFF00] md:block"
          style={{ boxShadow: "0 0 0 1px rgba(204,255,0,0.4) inset" }}
        />

        <div className="relative px-4 pb-8 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
          {/* Top bar — brand mark + toolbar */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <BrandMark size="md" />
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <GlobalSearch />
              <GoogleConnect compact />
              <Link
                href="/dashboard/projects"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
              >
                <Plus size={13} /> New
              </Link>
            </div>
          </div>

          {/* Editorial headline */}
          <div className="mt-10 max-w-4xl sm:mt-14 lg:mt-20">
            <h1 className="text-[34px] font-light leading-[1] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[88px]">
              We build the<br />
              intelligence behind<br />
              <span className="italic text-[#CCFF00]">every</span> jobsite.
            </h1>
            <div className="mt-7 flex items-center gap-6 sm:mt-10">
              <Link
                href="/dashboard/projects"
                className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white transition-colors hover:text-[#CCFF00]"
              >
                Explore Workspace <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <main className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {dataError && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Dashboard data could not load.</p>
              <p className="mt-0.5 text-amber-300/70">{dataError}</p>
            </div>
          </div>
        )}

        {/* Editorial KPI band — hairline separators, no cards */}
        <div className="mb-10 border-y border-white/8 py-6">
          {dataLoading ? (
            <div className="h-16 animate-pulse rounded bg-white/5" />
          ) : (
            <div className="grid grid-cols-2 gap-y-6 md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-white/5">
              {metrics.map((metric, index) => (
                <div key={metric.label} className={`px-4 sm:px-6 ${index === 0 ? "md:pl-0" : ""}`}>
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/35">{metric.label}</p>
                  <p className={`mt-2 font-mono text-[32px] font-light leading-none tracking-tight sm:mt-3 sm:text-[42px] ${index === 0 ? "text-[#CCFF00]" : "text-white"}`}>
                    {metric.value}
                  </p>
                  <p className="mt-2 text-[11px] text-white/30 sm:mt-3">{metric.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)]">
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <ProjectPipeline projects={filteredProjects} loading={dataLoading} />
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <ScheduleRiskPanel projects={filteredProjects} loading={dataLoading} />
              <Panel title="Operations at a Glance">
                <div className="divide-y divide-white/5">
                  {([
                    { label: "Schedule tasks", value: data?.kpis.scheduleTasks ?? 0, tone: "text-[#00D2FF] bg-[#00D2FF]/10", icon: <Clock size={13} /> },
                    { label: "Needs takeoff", value: pendingTakeoffs, tone: "text-[#CCFF00] bg-[#CCFF00]/10", icon: <Layers size={13} /> },
                    { label: "Over budget", value: overBudget, tone: "text-amber-400 bg-amber-400/10", icon: <AlertTriangle size={13} /> },
                    { label: "No alerts", value: Math.max((data?.kpis.projects ?? 0) - pendingTakeoffs - overBudget, 0), tone: "text-white/50 bg-white/5", icon: <CheckCircle2 size={13} /> },
                  ] as { label: string; value: number; tone: string; icon: React.ReactNode }[]).map((item) => (
                    <div key={item.label} className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`flex items-center justify-center rounded-md p-1.5 ${item.tone}`}>{item.icon}</span>
                        <span className="text-sm text-white/50">{item.label}</span>
                      </div>
                      <span className={`rounded-lg px-3 py-1 text-lg font-black ${item.tone}`}>{dataLoading ? "--" : item.value}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4">
            <GoogleCalendarCard />
            <GmailInboxCard />
            <AICommandPanel
              aiInput={aiInput}
              aiMessages={aiMessages}
              aiLoading={aiLoading}
              setAiInput={setAiInput}
              onSubmit={handleAISubmit}
              chatEndRef={chatEndRef}
            />
            <DocumentIntelligence data={data} loading={dataLoading} />
            <ActivityFeed items={data?.activity ?? []} loading={dataLoading} />
            <RecentContactsCard />
            <AuditActivityCard />
          </div>
        </div>

        <footer className="mt-8 flex items-center justify-between border-t border-white/5 pt-4 text-xs text-white/20">
          <span>Construction platform · A Onyx &amp; Iron Company</span>
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen size={12} /> {data?.kpis.projects ?? 0} projects
          </span>
        </footer>
      </main>
    </div>
  );
}
