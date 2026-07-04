"use client";

import { useEffect, useState } from "react";

interface GmailThread {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  received_at: string | null;
  unread: boolean;
  gmail_url: string;
}

interface Response {
  threads: GmailThread[];
  connected: boolean;
}

function fromName(raw: string): string {
  // "Kate Smith <kate@example.com>" -> "Kate Smith"; fallback to email.
  const m = raw.match(/^\s*(?:"?([^"<]+?)"?\s*<)?([^>]+@[^>]+)>?\s*$/);
  return (m?.[1] ?? m?.[2] ?? raw).trim();
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function GmailInboxCard() {
  const [state, setState] = useState<Response | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/google/gmail/unread?limit=6", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as Response;
        if (!cancelled) setState(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Inbox</div>
        <div className="mt-2 text-xs text-white/40">Couldn&apos;t load — {err}</div>
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Inbox</div>
        <div className="mt-3 h-14 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Inbox</div>
          <a href="/api/google/connect" className="text-[10px] uppercase tracking-widest font-mono text-[#CCFF00] hover:opacity-80">Connect →</a>
        </div>
        <div className="mt-2 text-xs text-white/40">Link Google to see unread mail.</div>
      </div>
    );
  }

  if (state.threads.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Inbox</div>
          <a
            href="https://mail.google.com"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white/70"
          >
            Gmail ↗
          </a>
        </div>
        <div className="mt-2 text-xs text-white/40">Inbox zero — nice.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">
          Unread <span className="text-white/60">· {state.threads.length}</span>
        </div>
        <a
          href="https://mail.google.com"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] uppercase tracking-widest font-mono text-white/40 hover:text-white/70"
        >
          Open ↗
        </a>
      </div>
      <ul className="mt-2 divide-y divide-white/5">
        {state.threads.map((t) => (
          <li key={t.id} className="py-2">
            <a href={t.gmail_url} target="_blank" rel="noreferrer" className="group block">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-white group-hover:text-[#CCFF00] transition-colors line-clamp-1">
                  {fromName(t.from)}
                </span>
                <span className="text-[10px] text-white/40 font-mono ml-auto shrink-0">{relTime(t.received_at)}</span>
              </div>
              <div className="mt-0.5 line-clamp-1 text-[11px] font-medium text-white/70">{t.subject}</div>
              {t.snippet && (
                <div className="mt-0.5 line-clamp-1 text-[10px] text-white/40">{t.snippet}</div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
