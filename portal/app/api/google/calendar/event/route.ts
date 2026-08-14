import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { auditInsert } from "@/lib/audit";
import { requiresExplicitConfirmation } from "@/lib/google/external-action";

export const runtime = "nodejs";

/**
 * Create a Google Calendar event (inspection, delivery, milestone…).
 * Accepts all-day (date) or timed (dateTime) events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const t = await requireGoogleToken(req);
    if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });
    await assertPermission(t.tenantId, t.userId, "field", "write");

    const { summary, description, location, start, end, allDay, confirmed } = await req.json() as {
      summary?: string; description?: string; location?: string;
      start?: string; end?: string; allDay?: boolean; confirmed?: boolean;
    };
    if (!summary || !start) return NextResponse.json({ error: "summary and start are required" }, { status: 400 });
    if (requiresExplicitConfirmation(confirmed)) return NextResponse.json({ error: "Explicit confirmation is required before creating a calendar event", code: "CONFIRMATION_REQUIRED" }, { status: 409 });
    if (summary.length > 300 || (description?.length ?? 0) > 20_000 || (location?.length ?? 0) > 1000) {
      return NextResponse.json({ error: "Calendar event exceeds allowed limits" }, { status: 413 });
    }

    const endVal = end || start;
    const startDate = new Date(start);
    const endDate = new Date(endVal);
    if (!allDay && (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()))) {
      return NextResponse.json({ error: "Invalid calendar date or time" }, { status: 400 });
    }
    const startObj = allDay ? { date: start } : { dateTime: startDate.toISOString() };
    const endObj = allDay ? { date: endVal } : { dateTime: endDate.toISOString() };

    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ summary, description: description ?? "", location: location ?? "", start: startObj, end: endObj }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      return NextResponse.json({ error: `[calendar ${res.status}] ${detail.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json() as { id?: string; htmlLink?: string };
    auditInsert({ tenant_id: t.tenantId, user_id: t.userId, table_name: "external_google_calendar_event", record_id: data.id ?? crypto.randomUUID(), new_values: { summary, start, end: endVal, all_day: Boolean(allDay) } });
    return NextResponse.json({ ok: true, event_id: data.id, url: data.htmlLink });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PermissionError ? 403 : 500 });
  }
}
