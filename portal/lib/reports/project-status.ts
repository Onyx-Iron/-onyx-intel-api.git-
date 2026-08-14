import { buildGroundedSystemPrompt } from "@/lib/ai/grounding";
import { generateText, NoProviderError } from "@/lib/ai/providers";
import { buildEstimateQualityReport, type EstimateQcItem } from "@/lib/estimating/estimate-qc";
import { listCurrentEstimateItems, normalizeCurrentEstimateItemForQc } from "@/lib/estimating/current-version";
import { createServiceClient } from "@/lib/supabase/server";
import { formatProjectKnowledgeForAi, loadProjectKnowledgeSnapshot } from "@/lib/projects/knowledge";

const SYSTEM = buildGroundedSystemPrompt(
  "You are a senior construction project manager writing a concise executive status report. " +
    "Use the structured project data provided. Produce: (1) a one-paragraph executive summary, " +
    "(2) Schedule & Progress, (3) Budget & Estimate, (4) Open Items & Risks (RFIs, submittals, change orders, punch, permits, procurement), " +
    "(5) Recent Field Activity, (6) Recommended Next Actions. Be specific and reference the real numbers. " +
    "If data is missing, say so briefly.",
  { sourceLabel: "structured project data" },
);

export interface ProjectStatusReportResult {
  report: string;
  provider: string;
  completion: number;
  estimate_value: number;
  estimate_quality: ReturnType<typeof buildEstimateQualityReport>;
  project: {
    id: string;
    name: string;
    status: string;
    budget: number | null;
    start_date: string | null;
    end_date: string | null;
    city: string | null;
    state: string | null;
  };
}

export async function generateProjectStatusReport(
  tenantId: string,
  projectId: string,
): Promise<ProjectStatusReportResult> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [proj, tasks, punch, permits, procurement, logs, rfis, submittals, changeOrders] = await Promise.all([
    db.from("projects").select("id,name,status,budget,start_date,end_date,city,state").eq("tenant_id", tenantId).eq("id", projectId).single(),
    db.from("schedule_tasks").select("status").eq("tenant_id", tenantId).eq("project_id", projectId).limit(3000),
    anyDb.from("punch_list_items").select("description,status,priority").eq("tenant_id", tenantId).eq("project_id", projectId).in("status", ["open", "in_progress"]).limit(50),
    anyDb.from("permit_items").select("permit_type,status").eq("tenant_id", tenantId).eq("project_id", projectId).limit(50),
    anyDb.from("procurement_items").select("description,status,required_date").eq("tenant_id", tenantId).eq("project_id", projectId).neq("status", "delivered").limit(50),
    anyDb.from("daily_logs").select("log_date,work_performed,crew_count,weather").eq("tenant_id", tenantId).eq("project_id", projectId).order("log_date", { ascending: false }).limit(5),
    anyDb.from("rfi_items").select("number,subject,status,priority,due_date").eq("tenant_id", tenantId).eq("project_id", projectId).in("status", ["open", "answered"]).limit(25),
    anyDb.from("submittal_items").select("number,title,status,due_date,responsible").eq("tenant_id", tenantId).eq("project_id", projectId).in("status", ["submitted", "under_review", "revise_resubmit", "rejected"]).limit(25),
    anyDb.from("change_order_items").select("number,description,status,amount").eq("tenant_id", tenantId).eq("project_id", projectId).in("status", ["pending", "approved"]).limit(25),
  ]);

  const p = proj.data as ProjectStatusReportResult["project"] | null;
  if (!p) throw new Error("Project not found");

  const taskRows = (tasks.data ?? []) as Array<{ status: string }>;
  const done = taskRows.filter((x) => x.status === "complete").length;
  const completion = taskRows.length ? Math.round((done / taskRows.length) * 100) : 0;
  const currentEstimateItems = await listCurrentEstimateItems(anyDb, tenantId, projectId);
  const estimateQuality = buildEstimateQualityReport(currentEstimateItems.map(normalizeCurrentEstimateItemForQc) as EstimateQcItem[]);
  const estVal = estimateQuality.totals.grand_total;
  const punchRows = (punch.data ?? []) as Array<{ description: string; status: string; priority: string }>;
  const permitRows = (permits.data ?? []) as Array<{ permit_type: string; status: string }>;
  const procRows = (procurement.data ?? []) as Array<{ description: string; status: string; required_date: string | null }>;
  const logRows = (logs.data ?? []) as Array<{ log_date: string; work_performed: string | null; crew_count: number | null; weather: string | null }>;
  const rfiRows = rfis.error ? [] : (rfis.data ?? []) as Array<{ number: string | null; subject: string; status: string; priority: string; due_date: string | null }>;
  const submittalRows = submittals.error ? [] : (submittals.data ?? []) as Array<{ number: string | null; title: string; status: string; due_date: string | null; responsible: string | null }>;
  const changeOrderRows = changeOrders.error ? [] : (changeOrders.data ?? []) as Array<{ number: string | null; description: string; status: string; amount: number | null }>;
  const unifiedKnowledge = await loadProjectKnowledgeSnapshot(tenantId, projectId);

  const ctx = [
    `PROJECT: ${p.name} (${[p.city, p.state].filter(Boolean).join(", ") || "location n/a"})`,
    `Status: ${p.status} | Timeline: ${p.start_date ?? "TBD"} -> ${p.end_date ?? "TBD"}`,
    `Schedule: ${done}/${taskRows.length} tasks complete (${completion}%)`,
    `Budget: ${p.budget != null ? `$${p.budget.toLocaleString()}` : "not set"} | Estimated cost so far: $${Math.round(estVal).toLocaleString()}`,
    `Estimate QC: ${estimateQuality.ready_for_proposal ? "ready for proposal" : "not ready for proposal"} | Risk score: ${estimateQuality.risk_score}/100 | Source-backed: ${estimateQuality.counts.source_backed}/${estimateQuality.counts.total_items} | Needs pricing: ${estimateQuality.counts.unpriced} | Needs review: ${estimateQuality.counts.review} | Missing evidence: ${estimateQuality.counts.missing_evidence}`,
    ...estimateQuality.blockers.map((x) => `Estimate blocker: ${x}`),
    "",
    `OPEN PUNCH ITEMS (${punchRows.length}):`,
    ...punchRows.slice(0, 20).map((x) => `  - [${x.priority}/${x.status}] ${x.description}`),
    "",
    `OPEN RFIS (${rfiRows.length}):`,
    ...rfiRows.map((x) => `  - ${x.number ?? "RFI"} [${x.priority}/${x.status}] ${x.subject}${x.due_date ? `, due ${x.due_date}` : ""}`),
    "",
    `OPEN SUBMITTALS (${submittalRows.length}):`,
    ...submittalRows.map((x) => `  - ${x.number ?? "Submittal"} [${x.status}] ${x.title}${x.responsible ? `, ${x.responsible}` : ""}${x.due_date ? `, due ${x.due_date}` : ""}`),
    "",
    `CHANGE ORDERS (${changeOrderRows.length}):`,
    ...changeOrderRows.map((x) => `  - ${x.number ?? "CO"} [${x.status}] ${x.description}${x.amount != null ? `, $${Number(x.amount).toLocaleString()}` : ""}`),
    "",
    `PERMITS (${permitRows.length}):`,
    ...permitRows.map((x) => `  - ${x.permit_type}: ${x.status}`),
    "",
    `OUTSTANDING PROCUREMENT (${procRows.length}):`,
    ...procRows.slice(0, 20).map((x) => `  - ${x.description} (${x.status}${x.required_date ? `, needed ${x.required_date}` : ""})`),
    "",
    "RECENT DAILY LOGS:",
    ...logRows.map((x) => `  - ${x.log_date} (${x.weather ?? "?"}, ${x.crew_count ?? "?"} crew): ${x.work_performed ?? "no description"}`),
    unifiedKnowledge ? "" : null,
    unifiedKnowledge ? formatProjectKnowledgeForAi(unifiedKnowledge) : null,
  ].filter((line): line is string => line !== null).join("\n");

  try {
    const result = await generateText({ system: SYSTEM, prompt: ctx, maxTokens: 3000 });
    return {
      report: result.text,
      provider: result.provider,
      completion,
      estimate_value: Math.round(estVal),
      estimate_quality: estimateQuality,
      project: p,
    };
  } catch (e) {
    if (e instanceof NoProviderError) {
      throw e;
    }
    throw e;
  }
}
