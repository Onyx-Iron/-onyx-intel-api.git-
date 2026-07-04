/**
 * Daily Log Assistant — drafts a structured daily log entry for a project on a
 * given date using yesterday's log for continuity, today's scheduled tasks, and
 * any active RFIs/punch items. Does NOT auto-save; returns the draft for review.
 */

import { generateText } from "@/lib/ai/providers";
import { getControlDb, type ControlDb } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export interface DailyLogDraft {
  date: string;
  work_performed: string;
  materials: string;
  equipment: string;
  safety: string;
  notes: string;
}

export interface DailyLogAssistantResult {
  run_id: string;
  draft: DailyLogDraft;
}

const SYSTEM_PROMPT =
  "You are a construction superintendent's assistant. Draft a daily log entry " +
  "using realistic structured sections (work_performed, materials, equipment, " +
  "safety, notes). Use placeholder values like '[crew size]' or '[verify]' where " +
  "information is unknown — do NOT invent specific facts. Return STRICT JSON: " +
  "{ work_performed, materials, equipment, safety, notes }. Cap the entire report at 250 words.";

function yesterdayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

function parseDraft(raw: string, date: string): DailyLogDraft {
  const fallback: DailyLogDraft = {
    date,
    work_performed: "[verify]",
    materials: "[verify]",
    equipment: "[verify]",
    safety: "Daily toolbox talk held; PPE compliance verified.",
    notes: "[verify]",
  };
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<DailyLogDraft>;
    return {
      date,
      work_performed: parsed.work_performed ?? fallback.work_performed,
      materials: parsed.materials ?? fallback.materials,
      equipment: parsed.equipment ?? fallback.equipment,
      safety: parsed.safety ?? fallback.safety,
      notes: parsed.notes ?? fallback.notes,
    };
  } catch {
    return fallback;
  }
}

export async function runDailyLogAssistant(
  tenantId: string,
  projectId: string,
  dateInput?: string,
): Promise<DailyLogAssistantResult> {
  const date = (dateInput ?? new Date().toISOString().slice(0, 10)).trim();
  const yesterday = yesterdayOf(date);

  const db = await createServiceClient();
  const startedAt = new Date().toISOString();

  const { data: runRow, error: insertErr } = await db
    .from("agent_runs")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      agent_kind: "daily_log_assistant",
      status: "running",
      input: { project_id: projectId, date },
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    throw new Error(`[daily_log_assistant] insert run failed: ${insertErr?.message ?? "no row"}`);
  }
  const runId = (runRow as { id: string }).id;

  try {
    const controlDb = await getControlDb();

    // yesterday's log (for continuity)
    const { data: yLog } = await db
      .from("daily_logs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("log_date", yesterday)
      .limit(1)
      .single();

    const schedule = await safeFrom<Record<string, unknown>>(
      controlDb,
      "schedule_tasks",
      tenantId,
      projectId,
    );
    const rfis = await safeFrom<Record<string, unknown>>(controlDb, "rfi_items", tenantId, projectId);
    const punch = await safeFrom<Record<string, unknown>>(
      controlDb,
      "punch_list_items",
      tenantId,
      projectId,
    );

    const tasksToday = schedule.filter((t) => {
      const start = (t.start_date as string) ?? null;
      const end = (t.end_date as string) ?? null;
      return start && end && start <= date && end >= date;
    });
    const activeRfis = rfis.filter((r) => (r.status as string) !== "closed").slice(0, 10);
    const openPunch = punch.filter((p) => (p.status as string) !== "completed").slice(0, 10);

    const context = {
      date,
      weather: "[no weather API configured — placeholder]",
      yesterdays_log_summary: yLog
        ? {
            work_performed: (yLog as { work_performed?: string }).work_performed ?? null,
            notes: (yLog as { notes?: string }).notes ?? null,
          }
        : null,
      scheduled_tasks_today: tasksToday.map((t) => ({
        title: t.title ?? t.name,
        status: t.status,
      })),
      active_rfis: activeRfis.map((r) => ({ title: r.title, status: r.status })),
      open_punch_items: openPunch.map((p) => ({ title: p.title, priority: p.priority })),
    };

    const { text } = await generateText({
      system: SYSTEM_PROMPT,
      prompt: `Context:\n${JSON.stringify(context, null, 2)}`,
      json: true,
      maxTokens: 1200,
      temperature: 0.3,
    });

    const draft = parseDraft(text, date);

    await db
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { draft, context_used: context },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { run_id: runId, draft };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .from("agent_runs")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
      .eq("id", runId);
    throw err;
  }
}
