"use client";

import { useEffect, useState } from "react";

interface AuditLogRow {
  id: string;
  user_id: string | null;
  action_type: string;
  table_name: string;
  record_id: string;
  created_at: string;
}

function actionTone(a: string): string {
  if (a === "insert") return "text-[#CCFF00]";
  if (a === "delete") return "text-red-400";
  return "text-cyan-400";
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Ported from the retired /dashboard/command-center page (frontend-backend
// reconciliation, item 2) - the raw table-level audit trail is distinct
// from OnyxIntelDashboard's own "Recent Activity" panel (which shows
// higher-level project events, not row-level insert/update/delete records),
// so this is preserved as its own card rather than dropped.
export default function AuditActivityCard() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/audit-logs?limit=12", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as { items?: AuditLogRow[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `Could not load audit activity (${res.status}). Refresh and try again.`);
        if (!cancelled) setRows(data.items ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Recent Audit Activity</div>
        {rows && <span className="text-[10px] font-mono text-white/40">{rows.length}</span>}
      </div>
      {err ? (
        <div className="mt-2 text-xs text-amber-200">{err}. Recent audit rows will reappear after the next refresh.</div>
      ) : rows === null ? (
        <div className="mt-3 h-14 animate-pulse rounded bg-white/5" />
      ) : rows.length === 0 ? (
        <div className="mt-2 text-xs text-white/40">No audit activity yet. Changes will appear here automatically as you work in the app.</div>
      ) : (
        <ul className="mt-2 divide-y divide-white/5 max-h-[320px] overflow-y-auto">
          {rows.map((a) => (
            <li key={a.id} className="py-2">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] uppercase tracking-widest font-mono ${actionTone(a.action_type)}`}>{a.action_type}</span>
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">{a.table_name}</span>
                <span className="ml-auto text-[10px] font-mono text-white/30">{relTime(a.created_at)}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] font-mono text-white/50">{a.record_id}</div>
              {a.user_id && <div className="mt-0.5 text-[10px] text-white/30">by {a.user_id.slice(0, 12)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
