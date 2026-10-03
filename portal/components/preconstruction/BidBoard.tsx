"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BID_STAGES, BID_STAGE_LABELS, type BidStage } from "@/lib/preconstruction/stages";
import { useToast } from "@/components/common/Toast";

interface BidOpportunity {
  id: string;
  name: string;
  client_name: string | null;
  stage: BidStage;
  due_at: string | null;
  bid_value: number | null;
  project_id: string | null;
  source: string;
  notes: string | null;
}

const ACTIVE_COLUMNS: BidStage[] = [
  "identified", "pursuing", "takeoff", "pricing", "submitted", "won",
];

export default function BidBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BidOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/preconstruction/opportunities");
      const data = await res.json() as { opportunities?: BidOpportunity[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Load failed (${res.status})`);
      setRows(data.opportunities ?? []);
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const byStage = useMemo(() => {
    const map = new Map<BidStage, BidOpportunity[]>();
    for (const s of BID_STAGES) map.set(s, []);
    for (const r of rows) map.get(r.stage)?.push(r);
    return map;
  }, [rows]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/preconstruction/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          client_name: clientName.trim() || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          stage: "identified",
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setName("");
      setClientName("");
      setDueAt("");
      await load();
    } catch (err) {
      toast({ title: String(err instanceof Error ? err.message : err), kind: "error" });
    } finally {
      setCreating(false);
    }
  };

  const moveStage = async (id: string, stage: BidStage) => {
    const res = await fetch(`/api/preconstruction/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      toast({ title: String(data.error ?? "Update failed"), kind: "error" });
      return;
    }
    await load();
  };

  const linkProject = async (id: string) => {
    const res = await fetch(`/api/preconstruction/opportunities/${id}/link-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json() as { error?: string; project_id?: string };
    if (!res.ok) {
      toast({ title: String(data.error ?? "Link failed"), kind: "error" });
      return;
    }
    toast({ title: "Project linked", kind: "success" });
    await load();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Opportunity
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder="Highland School ITB"
            required
          />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Client
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder="Optional"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Due
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-[#CCFF00] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {creating ? "Adding…" : "Add bid"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-white/40">Loading board…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ACTIVE_COLUMNS.map((stage) => (
            <div
              key={stage}
              className="flex w-64 shrink-0 flex-col rounded-xl border border-white/10 bg-white/[0.02]"
            >
              <div className="border-b border-white/5 px-3 py-2">
                <p className="text-xs font-semibold text-white/80">{BID_STAGE_LABELS[stage]}</p>
                <p className="text-[10px] text-white/35">{byStage.get(stage)?.length ?? 0} cards</p>
              </div>
              <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto p-2">
                {(byStage.get(stage) ?? []).map((card) => (
                  <li key={card.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <p className="text-sm font-medium text-white">{card.name}</p>
                    {card.client_name && (
                      <p className="text-[11px] text-white/45">{card.client_name}</p>
                    )}
                    {card.due_at && (
                      <p className="mt-1 text-[10px] text-amber-200/80">
                        Due {new Date(card.due_at).toLocaleDateString()}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <select
                        value={card.stage}
                        onChange={(e) => void moveStage(card.id, e.target.value as BidStage)}
                        className="rounded border border-white/10 bg-black/50 px-1 py-0.5 text-[10px] text-white/70"
                      >
                        {BID_STAGES.map((s) => (
                          <option key={s} value={s}>{BID_STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                      {!card.project_id ? (
                        <button
                          type="button"
                          onClick={() => void linkProject(card.id)}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80"
                        >
                          Link project
                        </button>
                      ) : (
                        <>
                          <Link
                            href={`/dashboard/projects/${card.project_id}`}
                            className="rounded bg-[#CCFF00]/15 px-1.5 py-0.5 text-[10px] text-[#CCFF00]"
                          >
                            Project
                          </Link>
                          <Link
                            href={`/dashboard/projects/${card.project_id}/takeoff/canvas`}
                            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80"
                          >
                            Takeoff
                          </Link>
                          <Link
                            href={`/dashboard/projects/${card.project_id}/estimate`}
                            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80"
                          >
                            Estimate
                          </Link>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
