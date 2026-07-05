"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, RefreshCw, ShieldAlert } from "lucide-react";

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
      const data = await res.json() as { digest: RiskDigest | null };
      setDigest(data.digest);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

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
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { digest: RiskDigest };
      setDigest(data.digest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#16161A] px-5 py-4 animate-pulse">
        <div className="h-4 w-32 bg-white/10 rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-3 bg-white/8 rounded" style={{ width: `${85 - i * 10}%` }} />)}
        </div>
      </div>
    );
  }

  if (!digest && !error) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#16161A] px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">AI Risk Digest</p>
          <p className="text-xs text-gray-600 mt-0.5">No digest generated yet</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#CCFF00]/10 border border-[#CCFF00]/20 text-[#CCFF00] text-xs hover:bg-[#CCFF00]/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Generating…" : "Generate"}
        </button>
      </div>
    );
  }

  if (error && !digest) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-[#16161A] px-5 py-4 flex items-center justify-between">
        <p className="text-xs text-red-400">Risk digest error: {error}</p>
        <button onClick={refresh} disabled={refreshing} className="text-xs text-gray-500 hover:text-white ml-4">
          Retry
        </button>
      </div>
    );
  }

  const cfg = LEVEL_CONFIG[digest!.risk_level] ?? LEVEL_CONFIG.medium;
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border bg-[#16161A] px-5 py-4 ${cfg.border}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cfg.badge}`}>
            <Icon size={11} />
            {cfg.label}
          </span>
          <span className="text-[10px] text-gray-600 font-mono">
            AI Risk Digest · {digest ? timeAgo(digest.generated_at) : ""}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Regenerate digest"
          className="flex items-center gap-1 text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40 text-[10px]"
        >
          <RefreshCw size={10} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Updating…" : "Refresh"}
        </button>
      </div>

      {/* Bullets */}
      <ul className="space-y-2">
        {(digest?.bullets ?? []).map((bullet, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
            <span className="text-[13px] text-gray-300 leading-snug">{bullet}</span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-2 text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}
