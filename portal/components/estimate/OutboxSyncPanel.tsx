"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

type OutboxEvent = {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  manual_takeoff_id: string | null;
  next_attempt_at: string | null;
  processed_at: string | null;
  created_at: string;
};

type Health = {
  counts: Record<string, number>;
  dead_letter: number;
  stale_pending: number;
  last_processed_at: string | null;
  alerts: string[];
  healthy: boolean;
};

type Props = {
  projectId: string;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "processed":
      return "text-[#CCFF00] bg-[#CCFF00]/10 border-[#CCFF00]/25";
    case "dead_letter":
      return "text-red-300 bg-red-400/10 border-red-400/30";
    case "failed":
      return "text-amber-300 bg-amber-400/10 border-amber-400/30";
    case "processing":
      return "text-[#00D2FF] bg-[#00D2FF]/10 border-[#00D2FF]/25";
    default:
      return "text-white/60 bg-white/5 border-white/15";
  }
}

/**
 * Project-scoped dead-letter / cron health panel for estimate sync outbox.
 */
export default function OutboxSyncPanel({ projectId }: Props) {
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/estimate/outbox?project_id=${encodeURIComponent(projectId)}&limit=30`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        events?: OutboxEvent[];
        health?: Health;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEvents(body.events ?? []);
      setHealth(body.health ?? null);
      if (body.health && !body.health.healthy) setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(id: string) {
    setRetryingId(id);
    try {
      const res = await fetch("/api/internal/outbox/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  }

  const alertCount = health?.alerts.length ?? 0;
  const deadLetter = events.filter((e) => e.status === "dead_letter" || e.status === "failed");

  return (
    <div className="border-t border-white/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          {health?.healthy === false ? (
            <AlertTriangle size={13} className="text-amber-400" />
          ) : (
            <CheckCircle2 size={13} className="text-[#CCFF00]/80" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Estimate sync health
          </span>
          {alertCount > 0 && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              {alertCount} alert{alertCount === 1 ? "" : "s"}
            </span>
          )}
          {health?.healthy && (
            <span className="text-[10px] text-white/30">Cron + outbox OK</span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/35">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/55">
            <span>Last processed: {fmtTime(health?.last_processed_at ?? null)}</span>
            <span className="text-white/25">·</span>
            <span>pending {health?.counts.pending ?? 0}</span>
            <span>failed {health?.counts.failed ?? 0}</span>
            <span>dead-letter {health?.counts.dead_letter ?? 0}</span>
            <span>processed {health?.counts.processed ?? 0}</span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/60 hover:text-white disabled:opacity-40"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Refresh
            </button>
          </div>

          {health?.alerts && health.alerts.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/90">
              {health.alerts.map((alert) => (
                <li key={alert} className="flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{alert}</span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
              {error}
            </p>
          )}

          {loading && events.length === 0 ? (
            <p className="text-[11px] text-white/35">Loading sync queue…</p>
          ) : deadLetter.length === 0 && (health?.healthy ?? true) ? (
            <p className="text-[11px] text-white/35">
              No dead-letter or failed sync events for this project.
            </p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {(deadLetter.length > 0 ? deadLetter : events.slice(0, 8)).map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${statusTone(event.status)}`}
                      >
                        {event.status}
                      </span>
                      <span className="font-mono text-[10px] text-white/45">{event.event_type}</span>
                      <span className="text-[10px] text-white/30">
                        {fmtTime(event.created_at)} · attempt {event.attempts}
                      </span>
                    </div>
                    {event.last_error && (
                      <p className="mt-1 truncate text-[11px] text-white/50" title={event.last_error}>
                        {event.last_error}
                      </p>
                    )}
                  </div>
                  {(event.status === "dead_letter" || event.status === "failed") && (
                    <button
                      type="button"
                      onClick={() => void retry(event.id)}
                      disabled={retryingId === event.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#CCFF00]/35 bg-[#CCFF00]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40"
                    >
                      {retryingId === event.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RotateCcw size={11} />
                      )}
                      Retry
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
