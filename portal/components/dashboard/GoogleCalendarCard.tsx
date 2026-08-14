"use client";

import { useEffect, useState } from "react";

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

interface Response {
  events: CalendarEvent[];
  connected: boolean;
}

function formatWhen(start: string | null, allDay: boolean): string {
  if (!start) return "";
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (allDay) {
    if (sameDay) return "Today · all day";
    if (isTomorrow) return "Tomorrow · all day";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · all day";
  }
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

export default function GoogleCalendarCard() {
  const [state, setState] = useState<Response | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/google/calendar/upcoming?limit=5", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as Partial<Response> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Could not load Calendar (${res.status}). Refresh and try again.`);
        if (!cancelled) setState({ events: data.events ?? [], connected: Boolean(data.connected) });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Calendar</div>
        <div className="mt-2 text-xs text-amber-200">{err}</div>
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Calendar</div>
        <div className="mt-3 h-14 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Calendar</div>
          <a href="/api/google/connect" className="text-[10px] uppercase tracking-widest font-mono text-[#CCFF00] hover:opacity-80">Connect</a>
        </div>
        <div className="mt-2 text-xs text-white/40">Connect Google to see today&apos;s schedule. If it should already be linked, reconnect once and refresh.</div>
      </div>
    );
  }

  if (state.events.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Upcoming</div>
          <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white/70">Google Calendar</a>
        </div>
        <div className="mt-2 text-xs text-white/40">No upcoming events.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Upcoming</div>
        <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white/70">Open</a>
      </div>
      <ul className="mt-2 divide-y divide-white/5">
        {state.events.map((e) => (
          <li key={e.id} className="py-2">
            <a href={e.html_link} target="_blank" rel="noreferrer" className="group block">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-white group-hover:text-[#CCFF00] transition-colors line-clamp-1">{e.summary}</span>
                {e.attendees > 0 && <span className="text-[10px] text-white/40 font-mono">· {e.attendees}p</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
                <span>{formatWhen(e.start, e.all_day)}</span>
                {e.location && <span className="line-clamp-1">· {e.location}</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
