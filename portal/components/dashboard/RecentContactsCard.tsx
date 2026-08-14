"use client";

import { useEffect, useState } from "react";

interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  project_id: string | null;
}

// Ported from the retired /dashboard/command-center page (frontend-backend
// reconciliation, item 2) - a quick contact directory glance on the
// Command Center, using the same workspace-wide /api/contacts endpoint the
// dedicated Contacts page already uses.
export default function RecentContactsCard() {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contacts?limit=8", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as { contacts?: ContactRow[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `Could not load contacts (${res.status}). Refresh and try again.`);
        if (!cancelled) setRows(data.contacts ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Contact Directory</div>
        <a href="/dashboard/contacts" className="text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white/70">View all</a>
      </div>
      {err ? (
        <div className="mt-2 text-xs text-amber-200">{err}. Open Contacts to keep moving while this reloads.</div>
      ) : rows === null ? (
        <div className="mt-3 h-14 animate-pulse rounded bg-white/5" />
      ) : rows.length === 0 ? (
        <div className="mt-2 text-xs text-white/40">No contacts yet. Add one in Contacts and it will show up here automatically.</div>
      ) : (
        <ul className="mt-2 divide-y divide-white/5">
          {rows.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate text-xs font-semibold text-white">{c.name ?? c.email ?? "Contact"}</div>
                {c.role && <span className="text-[9px] uppercase tracking-widest font-mono text-white/40 shrink-0">{c.role}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                {c.email && <a href={`mailto:${c.email}`} className="hover:text-[#CCFF00]">{c.email}</a>}
                {c.phone && <a href={`tel:${c.phone}`} className="hover:text-[#CCFF00]">{c.phone}</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
