"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface Recommendation {
  gaps?: Array<{
    item: {
      cost_code: string | null;
      description: string;
      quantity: number;
      unit: string;
    };
    cross_verified?: boolean;
    confidence?: number;
    vision_source?: string;
    raw_text?: string;
  }>;
  contradictions?: Array<{
    discipline: string;
    reason: string;
    a: { source: string; text: string; quantity?: number; unit?: string };
    b: { source: string; text: string; quantity?: number; unit?: string };
  }>;
  draft?: { subject: string; body: string };
  action?: string;
}

interface AuditItem {
  id: string;
  project_id: string | null;
  page_id: string | null;
  agent_name: string;
  execution_trigger: string;
  finding_summary: string;
  recommendations: Recommendation;
  severity: "info" | "warning" | "critical";
  status: string;
  created_at: string;
}

interface Props {
  initialItems: AuditItem[];
  projectNames: Record<string, string>;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function AgentApprovalFeed({ initialItems, projectNames }: Props) {
  const [items, setItems] = useState<AuditItem[]>(initialItems);
  const [busy, setBusy]   = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<"all" | "scope_gap_verifier" | "rfi_drafter">("all");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filterAgent === "all") return items;
    return items.filter((it) => it.agent_name === filterAgent);
  }, [items, filterAgent]);

  const decide = useCallback(async (id: string, decision: "approve" | "reject" | "modify") => {
    setBusy(id);
    setError(null);
    const prevItems = items;
    try {
      const res = await fetch(`/api/agents/audit-trails/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((it) => it.id !== id));
      } else {
        const err = await res.json().catch(() => ({}));
        setItems(prevItems);
        setError(`Decision failed: ${err.error ?? res.status}`);
      }
    } catch {
      setItems(prevItems);
      setError("Decision failed just now. Refresh and try again in a moment.");
    } finally {
      setBusy(null);
    }
  }, [items]);

  return (
    <div className="min-h-screen bg-[#06070A] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-[#CCFF00]">Agents</p>
            <h1 className="mt-1 text-2xl font-light tracking-tight">
              Human Approval Feed
              <span className="ml-3 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-mono text-white/70">
                {filtered.length} pending
              </span>
            </h1>
            <p className="mt-1 text-xs text-white/40">
              Nothing an agent proposes writes to your estimates or drafts an RFI until you approve it here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value as typeof filterAgent)}
              className="h-9 rounded-full border border-white/15 bg-black/40 px-3 text-xs font-mono uppercase tracking-widest focus:outline-none"
            >
              <option value="all">All agents</option>
              <option value="scope_gap_verifier">Scope Gap</option>
              <option value="rfi_drafter">RFI Drafter</option>
            </select>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white"
            >
              Back
            </Link>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 space-y-3">
        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-white/60">No findings waiting for review.</p>
            <p className="mt-2 text-xs text-white/40">
              As documents get processed, findings will appear here.
            </p>
          </div>
        )}

        {filtered.map((it) => {
          const tone = severityTone(it.severity);
          const open = openId === it.id;
          return (
            <div key={it.id} className={`rounded-xl border ${tone.border} bg-[#0E0F12] overflow-hidden`}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : it.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.02]"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${tone.dot} shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
                    <span>{it.agent_name.replace(/_/g, " ")}</span>
                    <span>·</span>
                    <span>{new Date(it.created_at).toLocaleString()}</span>
                    {it.project_id && projectNames[it.project_id] && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[220px]">{projectNames[it.project_id]}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-white">{it.finding_summary}</div>
                </div>
                <svg width="10" height="10" viewBox="0 0 12 12" className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`}>
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {open && (
                <div className="border-t border-white/5 px-4 py-3 space-y-3">
                  {/* Scope-gap details */}
                  {it.agent_name === "scope_gap_verifier" && it.recommendations.gaps && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-1">
                        Suggested estimate items
                      </div>
                      <div className="rounded-lg border border-white/10 divide-y divide-white/5">
                        {it.recommendations.gaps.map((g, i) => (
                          <div key={i} className="grid grid-cols-[80px_1fr_auto] gap-3 px-3 py-2 text-xs">
                            <span className="font-mono text-white/50">
                              {g.item.cost_code ? g.item.cost_code : "-"}
                            </span>
                            <span className="min-w-0">
                              <span className="text-white line-clamp-1">{g.item.description}</span>
                              {g.raw_text && <span className="mt-0.5 line-clamp-1 text-[10px] italic text-white/40">&ldquo;{g.raw_text}&rdquo;</span>}
                            </span>
                            <span className="flex items-center gap-2 whitespace-nowrap text-white/70">
                              <span className="font-mono">{g.item.quantity.toLocaleString()} {g.item.unit}</span>
                              {g.cross_verified && <span className="text-[9px] uppercase tracking-widest font-mono text-[#CCFF00]">verified</span>}
                              {typeof g.confidence === "number" && (
                                <span className={`text-[9px] uppercase tracking-widest font-mono ${confTone(g.confidence)}`}>
                                  {(g.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* RFI drafter details */}
                  {it.agent_name === "rfi_drafter" && (
                    <>
                      {it.recommendations.contradictions && (
                        <div>
                          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-1">Contradictions</div>
                          <div className="space-y-1.5">
                            {it.recommendations.contradictions.map((c, i) => (
                              <div key={i} className="rounded-lg border border-amber-400/20 bg-amber-400/[0.03] px-3 py-2 text-xs">
                                <div className="text-amber-300 font-semibold text-[11px]">{c.discipline} - {c.reason}</div>
                                <div className="mt-1 text-[10px] text-white/60">
                                  <div>A ({c.a.source}): &ldquo;{c.a.text.slice(0, 180)}&rdquo;</div>
                                  <div>B ({c.b.source}): &ldquo;{c.b.text.slice(0, 180)}&rdquo;</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {it.recommendations.draft && (
                        <div>
                          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-1">Draft preview</div>
                          <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                            <div className="text-[11px] font-semibold text-white">{it.recommendations.draft.subject}</div>
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-white/70 leading-snug">{it.recommendations.draft.body}</pre>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busy === it.id}
                      onClick={() => decide(it.id, "reject")}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/70 hover:border-red-400/40 hover:text-red-400 disabled:opacity-40"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busy === it.id}
                      onClick={() => decide(it.id, "modify")}
                      className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/85 hover:border-white/30 hover:text-white disabled:opacity-40"
                    >
                      Approve w/ modifications
                    </button>
                    <button
                      type="button"
                      disabled={busy === it.id}
                      onClick={() => decide(it.id, "approve")}
                      className="rounded-full bg-[#CCFF00] px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
                    >
                      {busy === it.id ? "..." : "Approve"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function severityTone(sev: string): { border: string; dot: string } {
  if (sev === "critical") return { border: "border-red-400/25",   dot: "bg-red-400" };
  if (sev === "warning")  return { border: "border-amber-400/25", dot: "bg-amber-400" };
  return { border: "border-white/10", dot: "bg-white/50" };
}
function confTone(c: number): string {
  if (c >= 0.85) return "text-[#CCFF00]";
  if (c >= 0.65) return "text-amber-400";
  return "text-white/50";
}
