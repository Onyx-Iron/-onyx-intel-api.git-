"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, ClipboardList, FileText, FolderKanban, Plus, RefreshCw, Send, Sparkles, StickyNote, Wand2 } from "lucide-react";
import AIProviderPicker from "@/components/ai/AIProviderPicker";

type TaskMode = "agentic" | "assist";
type AssistMode = "ask" | "draft_rfi" | "draft_submittal" | "summarize" | "scope";

interface ProjectRow {
  id: string;
  name: string;
  location: string;
  status: string;
  completion: number;
}

interface DashboardResponse {
  projects: ProjectRow[];
}

interface LogEntry {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  status: "running" | "done" | "error";
}

interface Template {
  label: string;
  description: string;
  mode: TaskMode;
  assistMode?: AssistMode;
  buildPrompt: (project: ProjectRow | null) => string;
}

interface WorkspaceAction {
  label: string;
  description: string;
  icon: React.ReactNode;
  run: (project: ProjectRow | null) => Promise<string>;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function endOfWeek(date: Date): Date {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 4);
  return result;
}

function normalizePrompt(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const TEMPLATES: Template[] = [
  {
    label: "RFI draft",
    description: "Draft an RFI from the selected project context.",
    mode: "assist",
    assistMode: "draft_rfi",
    buildPrompt: (project) =>
      project
        ? `Draft a complete RFI for ${project.name} in ${project.location}. Focus on the most likely ambiguity a PM would need clarified.`
        : "Draft a complete construction RFI using the current portfolio context.",
  },
  {
    label: "Schedule risk scan",
    description: "Check schedule pressure, missing work, and blockers.",
    mode: "agentic",
    buildPrompt: (project) =>
      project
        ? `Review ${project.name} for schedule risk, overdue work, and near-term blockers. Use any available tools to inspect project data, schedule tasks, and documents. Then summarize the top risks and next actions.`
        : "Review the portfolio for schedule risk, overdue work, and near-term blockers. Use available tools to inspect project data and summarize the top risks and next actions.",
  },
  {
    label: "Scope outline",
    description: "Create a trade scope with assumptions, inclusions, and exclusions.",
    mode: "assist",
    assistMode: "scope",
    buildPrompt: (project) =>
      project
        ? `Write an itemized civil scope of work for ${project.name} in ${project.location}. Include assumptions, exclusions, and open questions.`
        : "Write an itemized civil scope of work using the current portfolio context. Include assumptions, exclusions, and open questions.",
  },
  {
    label: "Submittal draft",
    description: "Draft a submittal transmittal for materials or equipment review.",
    mode: "assist",
    assistMode: "draft_submittal",
    buildPrompt: (project) =>
      project
        ? `Draft a construction submittal transmittal for ${project.name}. Include project, spec section, description, action requested, and review notes.`
        : "Draft a construction submittal transmittal using the current portfolio context.",
  },
];

export default function CommandCenterAutomation() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [result, setResult] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: "seed", title: "Automation center ready", detail: "Pick a project and choose a task to run.", timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), status: "done" },
  ]);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body as DashboardResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setDashboard(body);
        setProjectId(body.projects[0]?.id ?? "");
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setDashboard({ projects: [] });
          setLoadError(err instanceof Error ? err.message : "Could not load automation projects. Refresh the page and try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    outputRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, result]);

  const selectedProject = useMemo(
    () => dashboard?.projects.find((project) => project.id === projectId) ?? null,
    [dashboard, projectId],
  );

  const runWorkspaceAction = async (label: string, action: (project: ProjectRow | null) => Promise<string>) => {
    if (running) return;
    setRunning(true);
    const id = crypto.randomUUID();
    const timestamp = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    setLogs((previous) => [{ id, title: label, detail: selectedProject ? selectedProject.name : "Portfolio-wide", timestamp, status: "running" }, ...previous]);
    try {
      const text = await action(selectedProject);
      setResult(text);
      setLogs((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status: "done", detail: text } : entry)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(message);
      setLogs((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status: "error", detail: message } : entry)));
    } finally {
      setRunning(false);
    }
  };

  const workspaceActions: WorkspaceAction[] = useMemo(
    () => [
      {
        label: "Create status report",
        description: "Creates and stores a persistent project status report.",
        icon: <ClipboardList size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          const response = await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: project.id, report_type: "project_status" }),
          });
          const body = (await response.json().catch(() => ({}))) as { report?: { title?: string }; error?: string; code?: string };
          if (!response.ok) {
            if (body.code === "NO_PROVIDER") throw new Error("No AI provider configured for report generation.");
            throw new Error(body.error ?? `HTTP ${response.status}`);
          }
          return `Saved report: ${body.report?.title ?? "Project status report"}`;
        },
      },
      {
        label: "Create weekly log",
        description: "Create a weekly log entry for the selected project.",
        icon: <FileText size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          const today = new Date();
          const response = await fetch("/api/weekly-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: project.id,
              week_start: toIsoDate(startOfWeek(today)),
              week_end: toIsoDate(endOfWeek(today)),
              schedule_status: "on track",
              budget_status: "tracking",
              milestones_completed: [`Weekly automation check for ${project.name}`],
              upcoming_milestones: ["Review open actions", "Confirm blockers", "Prepare next-week priorities"],
              open_issues: ["None recorded by automation run"],
              decisions_needed: ["Confirm priority for next work cycle"],
              summary: `Automated weekly log created for ${project.name}.`,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as { log?: { week_start?: string }; error?: string };
          if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
          return `Saved weekly log for ${body.log?.week_start ?? toIsoDate(today)}`;
        },
      },
      {
        label: "Review takeoff & sync",
        description: "Open governed quantity review before anything enters estimating.",
        icon: <ClipboardList size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          window.location.assign(`/dashboard/projects/${encodeURIComponent(project.id)}?phase=Takeoff&sub=takeoff`);
          return "Opening governed takeoff review. Only validated, explicitly approved quantities can enter estimating.";
        },
      },
      {
        label: "Document scout",
        description: "Find a ready project document and summarize it.",
        icon: <FileText size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          const docsRes = await fetch(`/api/documents?project_id=${encodeURIComponent(project.id)}`);
          const docsBody = (await docsRes.json().catch(() => ({}))) as { documents?: Array<{ id: string; file_name: string }>; error?: string };
          if (!docsRes.ok) throw new Error(docsBody.error ?? `HTTP ${docsRes.status}`);
          const target = (docsBody.documents ?? []).find((doc) => doc.file_name.toLowerCase().endsWith(".pdf"));
          if (!target) throw new Error("No document available to scout.");
          const askRes = await fetch("/api/documents/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_id: target.id, question: "Summarize the document's purpose, key obligations, important dates, and any open risks." }),
          });
          const askBody = (await askRes.json().catch(() => ({}))) as { answer?: string; error?: string };
          if (!askRes.ok) throw new Error(askBody.error ?? `HTTP ${askRes.status}`);
          return `Document scout on ${target.file_name}: ${askBody.answer ?? "(no answer)"}`;
        },
      },
      {
        label: "New project",
        description: "Create a new project from a natural-language request.",
        icon: <FolderKanban size={15} />,
        run: async () => {
          const prompt = customPrompt.trim();
          if (!prompt) throw new Error("Type the project details first.");
          const normalized = normalizePrompt(prompt);
          const nameMatch = prompt.match(/(?:called|named)\s+["']?([^,"'\n]+)["']?/i) ?? prompt.match(/(?:project(?:\s+for)?|for)\s+["']?([^,"'\n]+)["']?/i);
          const locationMatch = prompt.match(/\bin\s+([^,.;\n]+?)(?:\s+(?:with|at|on|for)\b|[.,;]|$)/i);
          const rawName = nameMatch?.[1]?.trim() ?? prompt.replace(/^(create|new|start|add|spin up)\s+project\s*/i, "").trim();
          const name = rawName && rawName.length >= 3 ? rawName.slice(0, 120) : "Untitled Project";
          const location = locationMatch?.[1]?.trim() ?? "";
          const [city, state] = location.includes(",") ? location.split(",", 2).map((part) => part.trim()) : location ? [location, ""] : ["", ""];
          const response = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, city: city || null, state: state || null, status: normalized.includes("bid") ? "bidding" : "active", budget: null }),
          });
          const body = (await response.json().catch(() => ({}))) as { project?: { name?: string }; error?: string };
          if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
          return `Created project: ${body.project?.name ?? name}`;
        },
      },
      {
        label: "Add follow-up task",
        description: "Creates a durable task with context from the selected project.",
        icon: <StickyNote size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          const response = await fetch("/api/todo-items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: project.id,
              title: `Review automation output for ${project.name}`,
              notes: `Generated from the command center on ${new Date().toLocaleDateString("en-US")}.`,
              priority: "medium",
              status: "open",
            }),
          });
          const body = (await response.json().catch(() => ({}))) as { item?: { title?: string }; error?: string };
          if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
          return `Created task: ${body.item?.title ?? "Follow-up task"}`;
        },
      },
      {
        label: "Run tenant guard",
        description: "Scans app code for missing tenant isolation filters.",
        icon: <Wand2 size={15} />,
        run: async () => {
          const response = await fetch("/api/agents/tenant-guard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const body = (await response.json().catch(() => ({}))) as { files_scanned?: number; error?: string };
          if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
          return `Scanned ${body.files_scanned ?? 0} files`;
        },
      },
      {
        label: "Morning ops sweep",
        description: "Runs the daily log, risk, digest, and tenant guard checks together.",
        icon: <Sparkles size={15} />,
        run: async (project) => {
          if (!project) throw new Error("Pick a project first.");
          const [logRes, riskRes, digestRes, guardRes] = await Promise.all([
            fetch("/api/agents/daily-log-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: project.id }) }),
            fetch("/api/agents/risk-scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: project.id }) }),
            fetch("/api/ai/risk-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: project.id }) }),
            fetch("/api/agents/tenant-guard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
          ]);
          const logBody = (await logRes.json().catch(() => ({}))) as { draft?: { date?: string }; error?: string };
          const riskBody = (await riskRes.json().catch(() => ({}))) as { run_id?: string; findings?: Array<unknown>; error?: string };
          const digestBody = (await digestRes.json().catch(() => ({}))) as { digest?: { risk_level?: string }; error?: string; code?: string };
          const guardBody = (await guardRes.json().catch(() => ({}))) as { files_scanned?: number; error?: string };
          if (!logRes.ok) throw new Error(logBody.error ?? `HTTP ${logRes.status}`);
          if (!riskRes.ok) throw new Error(riskBody.error ?? `HTTP ${riskRes.status}`);
          if (!digestRes.ok) {
            if (digestBody.code === "NO_PROVIDER") throw new Error("No AI provider configured for risk digest generation.");
            throw new Error(digestBody.error ?? `HTTP ${digestRes.status}`);
          }
          if (!guardRes.ok) throw new Error(guardBody.error ?? `HTTP ${guardRes.status}`);
          return `Morning sweep complete: draft log ${logBody.draft?.date ?? "today"}, risk scout ${riskBody.run_id ?? ""}, digest ${digestBody.digest?.risk_level ?? "medium"}, tenant guard ${guardBody.files_scanned ?? 0} files`;
        },
      },
    ],
    [customPrompt],
  );

  const onTemplate = async (template: Template) => {
    if (running) return;
    const prompt = template.buildPrompt(selectedProject);
    const mode: TaskMode = template.mode === "agentic" && !selectedProject ? "assist" : template.mode;
    const assistMode: AssistMode | undefined = template.mode === "agentic" && !selectedProject ? "ask" : template.assistMode;
    const id = crypto.randomUUID();
    const timestamp = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    setRunning(true);
    setLogs((previous) => [{ id, title: template.label, detail: selectedProject ? selectedProject.name : "Portfolio-wide", timestamp, status: "running" }, ...previous]);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, assist_mode: assistMode, project_id: selectedProject?.id, message: prompt, prompt }),
      });
      const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
      const text = response.ok ? (body.text ?? "(no response)") : (body.error ?? `HTTP ${response.status}`);
      setResult(text);
      setLogs((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status: response.ok ? "done" : "error", detail: text } : entry)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(message);
      setLogs((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status: "error", detail: message } : entry)));
    } finally {
      setRunning(false);
    }
  };

  const runCustom = async () => {
    if (running || !customPrompt.trim()) return;
    const prompt = normalizePrompt(customPrompt);
    if (/(sync estimate|estimate sync|pull takeoffs into estimate|seed estimate from takeoff)/i.test(prompt)) return runWorkspaceAction("Review takeoff & sync", workspaceActions[2].run);
    if (/(document scout|scout the docs|summarize the document|what does this document say)/i.test(prompt)) return runWorkspaceAction("Document scout", workspaceActions[3].run);
    if (/(create project|new project|spin up project|start project)/i.test(prompt)) return runWorkspaceAction("New project", workspaceActions[4].run);
    if (/(morning sweep|ops sweep|daily sweep|start the day|check the project)/i.test(prompt)) return runWorkspaceAction("Morning ops sweep", workspaceActions[6].run);
    if (prompt.includes("rfi")) return onTemplate(TEMPLATES[0]);
    if (prompt.includes("submittal")) return onTemplate(TEMPLATES[3]);
    if (prompt.includes("scope")) return onTemplate(TEMPLATES[2]);
    return onTemplate(TEMPLATES[1]);
  };

  return (
    <div className="min-h-screen bg-[#06070A] text-white">
      <div className="border-b border-white/5 px-4 py-5 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#CCFF00]">Command Center</p>
            <h1 className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">Automation console</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/45">
              Pick a project or run a portfolio task, then use the buttons below to draft, check, or summarize the next step.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AIProviderPicker />
            <Link href="/dashboard/agents/pending" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white/80 hover:border-white/25 hover:text-white">
              <ClipboardList size={14} />
              Approvals
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-4 rounded-xl border border-white/8 bg-[#111113] p-4">
          {loadError && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-[11px] text-amber-200">
              <div className="font-semibold">Command center could not load projects.</div>
              <div className="mt-1 text-amber-200/80">{loadError}</div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 inline-flex h-7 items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-3 text-[10px] font-bold uppercase tracking-widest text-amber-100 transition-colors hover:border-amber-300/30 hover:bg-amber-300/15"
              >
                Retry
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/75">
              <FolderKanban size={15} />
              Project
            </div>
            <button type="button" onClick={() => void fetch("/api/dashboard", { cache: "no-store" }).then((r) => r.json()).then((body) => setDashboard(body))} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/45 hover:text-white">
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest text-white/30">Selected project</label>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#CCFF00]/40">
              <option value="">Portfolio-wide</option>
              {(dashboard?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Templates</p>
            {TEMPLATES.map((template) => (
              <button key={template.label} type="button" onClick={() => void onTemplate(template)} disabled={running || loading} className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-[#CCFF00]/25 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white/85">{template.label}</span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/35">{template.mode}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/40">{template.description}</p>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Helpful actions</p>
            {workspaceActions.map((action) => (
              <button key={action.label} type="button" onClick={() => void runWorkspaceAction(action.label, action.run)} disabled={running || loading} className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-[#00D2FF]/25 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white/85">
                    <span className="text-[#00D2FF]">{action.icon}</span>
                    {action.label}
                  </span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/35">save</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/40">{action.description}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <Wand2 size={15} className="text-[#CCFF00]" />
              Ask in plain English
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Example: summarize the project, draft an RFI, sync estimates, or inspect a job." className="min-h-[110px] flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#CCFF00]/40" />
              <div className="flex shrink-0 flex-col gap-2 sm:w-40">
                <button type="button" onClick={() => void runCustom()} disabled={running || !customPrompt.trim() || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#CCFF00] px-4 py-3 text-sm font-bold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                  <Send size={15} />
                  Run
                </button>
                <button type="button" onClick={() => setCustomPrompt("")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white/60 hover:text-white">
                  <Plus size={14} />
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/30">Latest result</p>
                <h2 className="mt-1 text-lg font-semibold text-white/85">Result</h2>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest ${running ? "bg-[#00D2FF]/10 text-[#00D2FF]" : "bg-white/5 text-white/35"}`}>
                {running ? <Bot size={12} /> : <CheckCircle2 size={12} />}
                {running ? "Running" : "Idle"}
              </span>
            </div>
            <div ref={outputRef} className="mt-4 min-h-[260px] rounded-lg border border-white/8 bg-black/30 p-4 text-sm leading-7 text-white/80">
              {result || (
                <div className="space-y-2 text-white/35">
                  <p>Choose a template on the left or type what you want done.</p>
                  <p>The response will appear here when it is ready.</p>
                </div>
              )}
              {result.includes("No AI provider configured") && (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
                  <p>No AI provider is connected yet. Open billing settings to add one, then try again.</p>
                  <Link
                    href="/dashboard/settings/billing"
                    className="mt-2 inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.03] px-3 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
                  >
                    Open billing settings
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Task log</p>
            <div className="mt-3 space-y-2">
              {logs.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white/80">{entry.title}</p>
                    <span className="text-[10px] uppercase tracking-widest text-white/25">{entry.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">{entry.detail}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-widest text-white/25">{entry.timestamp}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
