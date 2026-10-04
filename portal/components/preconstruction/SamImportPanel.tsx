"use client";

import { useState } from "react";
import { useToast } from "@/components/common/Toast";

interface SamNotice {
  source_ref: string;
  name: string;
  client_name: string | null;
  due_at: string | null;
  url: string | null;
}

export default function SamImportPanel({ onImported }: { onImported?: () => void }) {
  const { toast } = useToast();
  const [q, setQ] = useState("construction");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notices, setNotices] = useState<SamNotice[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    setHint(null);
    try {
      const res = await fetch(`/api/preconstruction/sam?q=${encodeURIComponent(q)}`);
      const data = await res.json() as { notices?: SamNotice[]; hint?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Search failed (${res.status})`);
      setNotices(data.notices ?? []);
      setSelected(new Set());
      if (data.hint) setHint(data.hint);
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    const chosen = notices.filter((n) => selected.has(n.source_ref || n.name));
    if (chosen.length === 0) return;
    if (!confirm(`Create ${chosen.length} bid card(s) from SAM.gov notices?`)) return;
    setImporting(true);
    try {
      const res = await fetch("/api/preconstruction/sam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notices: chosen }),
      });
      const data = await res.json() as { error?: string; created?: number };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      toast({ title: `Created ${data.created ?? chosen.length} bid card(s)`, kind: "success" });
      onImported?.();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          SAM.gov keyword search (free)
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void search()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          disabled={importing || selected.size === 0}
          onClick={() => void approve()}
          className="rounded-lg bg-[#CCFF00] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {importing ? "Creating…" : `Approve ${selected.size || ""}`}
        </button>
      </div>
      {hint && <p className="text-xs text-amber-200/80">{hint}</p>}
      {notices.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {notices.map((n) => {
            const key = n.source_ref || n.name;
            return (
              <li key={key} className="flex items-start gap-2 rounded border border-white/5 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    });
                  }}
                />
                <div className="min-w-0">
                  <p className="truncate text-xs text-white">{n.name}</p>
                  <p className="truncate text-[10px] text-white/40">
                    {n.client_name ?? "—"}
                    {n.due_at ? ` · due ${new Date(n.due_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
