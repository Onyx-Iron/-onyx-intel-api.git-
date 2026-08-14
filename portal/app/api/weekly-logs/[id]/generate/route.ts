import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { generateText, NoProviderError } from "@/lib/ai/providers";
import { logEvent } from "@/lib/activity";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext { params: Promise<{ id: string }> }

interface WeeklyLogRow {
  id: string;
  tenant_id: string;
  project_id: string;
  week_start: string;
  week_end: string;
  schedule_status: string | null;
  budget_status: string | null;
  milestones_completed: string | null;
  upcoming_milestones: string | null;
  open_issues: string | null;
  decisions_needed: string | null;
}

interface DailyLogRow {
  log_date: string;
  weather: string | null;
  temperature: string | null;
  crew_count: number | null;
  work_performed: string | null;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a senior construction project manager writing concise weekly status reports for ownership.
Produce a clean, structured Markdown report covering: Schedule, Budget, Milestones Completed, Upcoming Milestones, Open Issues, and Decisions Needed.
Use plain professional language. Cite specific dates from the daily logs where relevant. No filler.
HARD CAP: 200 words total across the entire report.`;

export async function POST(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    const db = await createServiceClient();

    // Fetch the weekly log (tenant-scoped)
    const { data: wkData, error: wkErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("weekly_logs" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (wkErr || !wkData) {
      return NextResponse.json({ error: `Weekly log not found: ${wkErr?.message ?? "unknown"}` }, { status: 404 });
    }
    const wk = wkData as unknown as WeeklyLogRow;

    // Pull daily logs in the week range (tenant + project scoped)
    const { data: dailyData, error: dailyErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("daily_logs" as any)
      .select("log_date, weather, temperature, crew_count, work_performed, notes")
      .eq("tenant_id", tenantId)
      .eq("project_id", wk.project_id)
      .gte("log_date", wk.week_start)
      .lte("log_date", wk.week_end)
      .order("log_date", { ascending: true });

    if (dailyErr) {
      return NextResponse.json({ error: `[generate] daily log fetch: ${dailyErr.message}` }, { status: 500 });
    }

    const dailyRows = (dailyData ?? []) as unknown as DailyLogRow[];

    const dailyDigest = dailyRows.length === 0
      ? "(No daily logs were recorded for this week.)"
      : dailyRows.map((r) => {
          const head = `${r.log_date}${r.weather ? ` — ${r.weather}` : ""}${r.temperature ? ` ${r.temperature}` : ""}${r.crew_count != null ? ` — crew ${r.crew_count}` : ""}`;
          const work = r.work_performed ? `Work: ${r.work_performed}` : "";
          const notes = r.notes ? `Notes: ${r.notes}` : "";
          return [head, work, notes].filter(Boolean).join("\n");
        }).join("\n---\n");

    const manualContext = [
      wk.schedule_status      ? `PM schedule note: ${wk.schedule_status}` : "",
      wk.budget_status        ? `PM budget note: ${wk.budget_status}`     : "",
      wk.milestones_completed ? `PM milestones completed: ${wk.milestones_completed}` : "",
      wk.upcoming_milestones  ? `PM upcoming milestones: ${wk.upcoming_milestones}`   : "",
      wk.open_issues          ? `PM open issues: ${wk.open_issues}`       : "",
      wk.decisions_needed     ? `PM decisions needed: ${wk.decisions_needed}` : "",
    ].filter(Boolean).join("\n");

    const userPrompt = `Project week: ${wk.week_start} to ${wk.week_end}.

Daily logs from the field:
${dailyDigest}

${manualContext ? `Additional PM context:\n${manualContext}\n` : ""}
Write the weekly status report now. Max 200 words total.`;

    let result;
    try {
      result = await generateText({
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: 700,
        temperature: 0.3,
      });
    } catch (e) {
      if (e instanceof NoProviderError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }

    const summary = result.text.trim();

    const { data: updated, error: updErr } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("weekly_logs" as any)
      .update({
        summary,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json({ error: `[generate] save summary: ${updErr.message}` }, { status: 500 });
    }

    void logEvent({
      projectId: wk.project_id,
      tenantId,
      userId,
      entityType: "weekly_log",
      entityId: wk.id,
      action: "generated",
      title: `Weekly report generated for week of ${wk.week_start}`,
    });

    return NextResponse.json({
      log: updated,
      provider: result.provider,
      model: result.model,
      daily_logs_used: dailyRows.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/weekly-logs/generate] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
