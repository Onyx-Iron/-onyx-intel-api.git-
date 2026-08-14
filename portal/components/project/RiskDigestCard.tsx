"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";

interface RiskDigest {
  id: string;
  risk_level: "low" | "medium" | "high" | "critical";
  bullets: string[];
  generated_at: string;
}
const LEVEL_CONFIG = {
  low: {
    label: "Low Risk",
    icon: CheckCircle,
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-400",
    border: "border-emerald-500/20",
  },
  medium: {
    label: "Medium Risk",
    icon: AlertCircle,
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
    border: "border-amber-500/20",
  },
  high: {
    label: "High Risk",
    icon: AlertTriangle,
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    dot: "bg-orange-400",
    border: "border-orange-500/20",
  },
  critical: {
    label: "Critical",
    icon: ShieldAlert,
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    dot: "bg-red-400",
    border: "border-red-500/20",
  },
} as const;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
export default function RiskDigestCard({ projectId }: { projectId: string }) {
  const [digest, setDigest] = useState<RiskDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/risk-digest?project_id=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { digest: RiskDigest | null };
      setDigest(data.digest);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the risk digest. Refresh the page and try again.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useProjectSyncRefresh(fetchDigest);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchDigest();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDigest]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/risk-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { digest: RiskDigest };
      setDigest(data.digest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the risk digest. Try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#16161A] px-5 py-4 animate-pulse">
        <div className="mb-3 h-4 w-32 rounded bg-white/10" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 rounded bg-white/8" style={{ width: `${85 - i * 10}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!digest && !error) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#16161A] px-5 py-4">
      <div>
        <p className="text-sm font-medium text-white">Risk summary</p>
        <p className="mt-0.5 text-xs text-gray-600">No risk summary yet. Generate one to get a quick read on schedule, scope, and open risks.</p>
      </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 py-1.5 text-xs text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/20 disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Generating..." : "Generate"}
        </button>
      </div>
    );
  }

  if (error && !digest) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-[#16161A] px-5 py-4">
        <div>
          <p className="text-sm font-medium text-white">Risk summary could not load.</p>
          <p className="mt-0.5 text-xs text-red-400">{error}</p>
          <p className="mt-1 text-[11px] text-white/40">Generate a new summary after the project data is ready, or retry once the backend is responsive again.</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="ml-4 inline-flex h-8 items-center rounded-full border border-red-400/20 bg-red-400/10 px-3 text-[10px] font-bold uppercase tracking-widest text-red-100 hover:border-red-300/30 hover:bg-red-300/15 disabled:opacity-40"
        >
          {refreshing ? "Retrying..." : "Retry"}
        </button>
      </div>
    );
  }

  const cfg = LEVEL_CONFIG[digest!.risk_level] ?? LEVEL_CONFIG.medium;
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border bg-[#16161A] px-5 py-4 ${cfg.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.badge}`}>
            <Icon size={11} />
            {cfg.label}
          </span>
          <span className="text-[10px] font-mono text-gray-600">
            Risk summary • {digest ? timeAgo(digest.generated_at) : ""}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Refresh the latest risk check"
          className="flex items-center gap-1 text-[10px] text-gray-600 transition-colors hover:text-gray-300 disabled:opacity-40"
        >
          <RefreshCw size={10} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Updating..." : "Refresh"}
        </button>
      </div>

      <ul className="space-y-2">
        {(digest?.bullets ?? []).map((bullet, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
            <span className="text-[13px] leading-snug text-gray-300">{bullet}</span>
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
