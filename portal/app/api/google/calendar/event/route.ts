import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";

export const runtime = "nodejs";

/**
 * Create a Google Calendar event (inspection, delivery, milestone…).
 * Accepts all-day (date) or timed (dateTime) events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const t = await requireGoogleToken(req);
  if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });

  const { summary, description, location, start, end, allDay } = await req.json() as {
    summary?: string; description?: string; location?: string;
    start?: string; end?: string; allDay?: boolean;
  };
  if (!summary || !start) return NextResponse.json({ error: "summary and start are required" }, { status: 400 });

  const endVal = end || start;
  const startObj = allDay ? { date: start } : { dateTime: new Date(start).toISOString() };
  const endObj = allDay ? { date: endVal } : { dateTime: new Date(endVal).toISOString() };

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
  return NextResponse.json({ ok: true, event_id: data.id, url: data.htmlLink });
}
