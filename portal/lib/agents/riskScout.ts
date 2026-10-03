/**
 * Risk Scout agent — analyzes a project's open-control state (RFIs, submittals,
 * schedule tasks, punch list, invoices, permits) and produces a ranked list of
 * top risks via the multi-model AI layer.
 */

import { generateText } from "@/lib/ai/providers";
import { getControlDb, type ControlDb } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchSiteForecast } from "@/lib/site/openMeteo";
import type { Json } from "@/lib/supabase/types";

export interface RiskFinding {
  title: string;
  severity: "low" | "med" | "high";
  impact: string;
  recommended_action: string;
}

export interface RiskScoutResult {
  run_id: string;
  findings: RiskFinding[];
  snapshot: Record<string, unknown>;
}

const SYSTEM_PROMPT =
  "You are a construction risk analyst. Given this project state snapshot, " +
  "identify the top 5 risks that could impact schedule, budget, or quality. " +
  "For each: title, severity (low/med/high), impact summary, recommended action. " +
  "Return STRICT JSON: { findings: [{ title, severity, impact, recommended_action }] }. " +
  "Cap the entire report at 250 words.";

async function safeFrom<T = unknown>(
  db: ControlDb,
  table: string,
  tenantId: string,
  projectId: string,
): Promise<T[]> {
  try {
    const { data, error } = await db
      .from<T[]>(table)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);
    if (error) return [];
    return (data as unknown as T[]) ?? [];
  } catch {
    return [];
  }
}

export async function buildProjectSnapshot(tenantId: string, projectId: string) {
  const db = await getControlDb();
  const today = new Date().toISOString().slice(0, 10);

  const [rfis, submittals, schedule, punch, invoices, permits, projectRow] = await Promise.all([
    safeFrom<Record<string, unknown>>(db, "rfi_items", tenantId, projectId),
    safeFrom<Record<string, unknown>>(db, "submittal_items", tenantId, projectId),
    safeFrom<Record<string, unknown>>(db, "schedule_tasks", tenantId, projectId),
    safeFrom<Record<string, unknown>>(db, "punch_list_items", tenantId, projectId),
    safeFrom<Record<string, unknown>>(db, "invoices", tenantId, projectId),
    safeFrom<Record<string, unknown>>(db, "permit_items", tenantId, projectId),
    db.from<Record<string, unknown>>("projects").select("latitude,longitude,city,state").eq("tenant_id", tenantId).eq("id", projectId).limit(1),
  ]);

  const openRfis = rfis.filter((r) => (r.status as string) !== "closed");
  const oldestOpenRfi = openRfis
    .map((r) => (r.created_at as string) ?? "")
    .filter(Boolean)
    .sort()[0];

  const overdueSubmittals = submittals.filter((s) => {
    const due = (s.due_date as string) ?? null;
    return due && due < today && (s.status as string) !== "approved";
  });

  const slippingSchedule = schedule.filter((t) => {
    const end = (t.end_date as string) ?? null;
    return (t.status as string) === "in_progress" && end && end < today;
  });

  const openCriticalPunch = punch.filter(
    (p) => (p.status as string) !== "completed" && (p.priority as string) === "critical",
  );

  const overdueInvoices = invoices.filter((i) => {
    const due = (i.due_date as string) ?? null;
    return due && due < today && (i.status as string) !== "paid";
  });

  const pendingPermits = permits.filter((p) => (p.status as string) !== "approved");

  let weather: {
    source: string;
    delay_risk_days: number;
    next_delay_dates: string[];
    location: string | null;
  } | null = null;
  const projRows = (Array.isArray(projectRow.data) ? projectRow.data : projectRow.data ? [projectRow.data] : []) as Array<{
    latitude?: number | null; longitude?: number | null; city?: string | null; state?: string | null;
  }>;
  const proj = projRows[0] ?? null;
  const lat = proj?.latitude;
  const lon = proj?.longitude;
  if (typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      const forecast = await fetchSiteForecast(lat, lon, 7);
      const delayDays = forecast.filter((d) => d.delayRisk);
      weather = {
        source: "open-meteo",
        delay_risk_days: delayDays.length,
        next_delay_dates: delayDays.map((d) => d.date).slice(0, 5),
        location: [proj?.city, proj?.state].filter(Boolean).join(", ") || null,
      };
    } catch {
      weather = {
        source: "open-meteo",
        delay_risk_days: 0,
        next_delay_dates: [],
        location: [proj?.city, proj?.state].filter(Boolean).join(", ") || null,
      };
    }
  }

  return {
    rfis_open: openRfis.length,
    rfis_oldest_open_created_at: oldestOpenRfi ?? null,
    submittals_overdue: overdueSubmittals.length,
    schedule_tasks_slipping: slippingSchedule.length,
    punch_critical_open: openCriticalPunch.length,
    invoices_overdue: overdueInvoices.length,
    invoices_overdue_total: overdueInvoices.reduce(
      (acc, i) => acc + Number((i.amount as number) ?? 0),
      0,
    ),
    permits_pending: pendingPermits.length,
    pending_permit_titles: pendingPermits.map((p) => p.title ?? p.name ?? "").filter(Boolean),
    slipping_task_titles: slippingSchedule
      .map((t) => t.title ?? t.name ?? "")
      .filter(Boolean)
      .slice(0, 10),
    weather,
  };
}

function parseFindings(raw: string): RiskFinding[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { findings?: RiskFinding[] };
    return Array.isArray(parsed.findings) ? parsed.findings.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export async function runRiskScout(
  tenantId: string,
  projectId: string,
): Promise<RiskScoutResult> {
  const db = await createServiceClient();
  const startedAt = new Date().toISOString();

  const { data: runRow, error: insertErr } = await db
    .from("agent_runs")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      agent_kind: "risk_scout",
      status: "running",
      input: { project_id: projectId },
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    throw new Error(`[risk_scout] insert run failed: ${insertErr?.message ?? "no row"}`);
  }
  const runId = (runRow as { id: string }).id;

  try {
    const snapshot = await buildProjectSnapshot(tenantId, projectId);
    const { text } = await generateText({
      system: SYSTEM_PROMPT,
      prompt: `Project snapshot:\n${JSON.stringify(snapshot, null, 2)}`,
      json: true,
      maxTokens: 1200,
      temperature: 0.2,
    });
    const findings = parseFindings(text);

    await db
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { findings, snapshot } as unknown as Json,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { run_id: runId, findings, snapshot };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .from("agent_runs")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
      .eq("id", runId);
    throw err;
  }
}

export async function getLastRiskScoutFindings(
  tenantId: string,
  projectId: string,
): Promise<{ run_id: string; findings: RiskFinding[]; created_at: string } | null> {
  const db = await createServiceClient();
  const { data } = await db
    .from("agent_runs")
    .select("id, output, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("agent_kind", "risk_scout")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  const row = data as { id: string; output: { findings?: RiskFinding[] } | null; created_at: string };
  return {
    run_id: row.id,
    findings: row.output?.findings ?? [],
    created_at: row.created_at,
  };
}
