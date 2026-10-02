"use client";

import { useState } from "react";
import type { VersionDiff } from "@/lib/estimating/version-diff";

interface VersionOption {
  id: string;
  version_number: number;
  status: string;
}

function money(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function VersionDiffPanel({ versions, currentId }: { versions: VersionOption[]; currentId: string | null }) {
  const ordered = [...versions].sort((a, b) => a.version_number - b.version_number);
  const current = ordered.find((v) => v.id === currentId) ?? ordered[ordered.length - 1];
  const previous = ordered.filter((v) => current && v.version_number < current.version_number).at(-1) ?? ordered[0];
  const [left, setLeft] = useState(previous?.id ?? "");
  const [right, setRight] = useState(current?.id ?? "");
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (ordered.length < 2) return null;

  async function compare() {
    if (!left || !right || left === right) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate/versions/diff?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`, { cache: "no-store" });
      const body = await res.json() as { diff?: VersionDiff; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Diff failed");
      setDiff(body.diff ?? null);
    } catch (err) {
      setDiff(null);
      setError(err instanceof Error ? err.message : "Diff failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-mono uppercase tracking-widest text-white/40">Compare</span>
        <select value={left} onChange={(e) => setLeft(e.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
          {ordered.map((v) => <option key={v.id} value={v.id}>v{v.version_number} · {v.status}</option>)}
        </select>
        <span className="text-white/30">to</span>
        <select value={right} onChange={(e) => setRight(e.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
          {ordered.map((v) => <option key={v.id} value={v.id}>v{v.version_number} · {v.status}</option>)}
        </select>
        <button type="button" onClick={() => void compare()} disabled={loading || left === right} className="rounded-full border border-white/15 px-3 py-1 font-semibold uppercase tracking-widest text-white/80 hover:text-white disabled:opacity-40">
          {loading ? "Comparing…" : "Show diff"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
      {diff && (
        <div className="mt-3 space-y-2 text-[11px] text-white/70">
          <p>{diff.added.length} added · {diff.removed.length} removed · {diff.changed.length} changed</p>
          {diff.changed.slice(0, 8).map((change) => (
            <div key={change.key} className="flex justify-between gap-4 border-t border-white/5 pt-1">
              <span className="truncate">{change.right.description || change.right.csi_code || change.key}</span>
              <span className="shrink-0 font-mono text-[#CCFF00]">{money(change.totalDelta)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
