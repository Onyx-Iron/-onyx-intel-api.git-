import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * GET /api/google/calendar/upcoming?limit=5
 *
 * Returns the next N events from the user's primary Google Calendar starting
 * "now". Response shape stays flat + view-friendly — the dashboard widget
 * renders it directly.
 */
interface CalendarEvent {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  all_day: boolean;
  location: string | null;
  html_link: string;
  attendees: number;
}

interface GoogleCalendarItem {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  attendees?: unknown[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const token = await getAccessToken(tenantId, userId);
    if (!token) {
      return NextResponse.json({ events: [], connected: false }, { status: 200 });
    }

    const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "5", 10) || 5));
    const timeMin = new Date().toISOString();

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("maxResults", String(limit));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      // Avoid Next.js caching a user-specific response
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      return NextResponse.json({ error: `Calendar API ${res.status}: ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json() as { items?: GoogleCalendarItem[] };
    const events: CalendarEvent[] = (data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      all_day: !!e.start?.date && !e.start?.dateTime,
      location: e.location ?? null,
      html_link: e.htmlLink ?? "https://calendar.google.com",
      attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
    }));

    return NextResponse.json({ events, connected: true }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[calendar/upcoming] ${msg}` }, { status: 500 });
  }
}
