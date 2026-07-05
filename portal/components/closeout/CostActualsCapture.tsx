"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { UniversalImportButton } from "@/components/common/UniversalImportButton";
import { useBulkImport, toNum, toStr } from "@/components/common/useBulkImport";

interface CodeOption {
  csi_code: string;
  description: string | null;
}

interface ActualRow {
  id: string;
  csi_code: string;
  quantity: number | null;
  actual_unit_cost: number;
  estimated_unit_cost: number | null;
  variance_pct: number | null;
  created_at?: string;
}

interface ActualPayload {
  project_id: string;
  csi_code: string;
  quantity: number | null;
  actual_unit_cost: number;
  estimated_unit_cost: number | null;
}

interface Props {
  projectId: string;
}

type Mode = "quick" | "bulk";

export default function CostActualsCapture({ projectId }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("quick");
  const [items, setItems] = useState<ActualRow[]>([]);
  const [codes, setCodes] = useState<CodeOption[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);

  const [csiCode, setCsiCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [saving, setSaving] = useState(false);

  const loadActuals = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/cost-catalog/actuals?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      const rows: ActualRow[] = Array.isArray(data?.actuals)
        ? data.actuals
        : Array.isArray(data)
          ? data
          : [];
      setItems(rows);
    } catch {
      // best-effort; don't block UI
    }
  }, [projectId]);

  useEffect(() => {
    void loadActuals();
  }, [loadActuals]);

  // Lightweight code list for dropdown — uses cost-catalog v2 listing endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCodes(true);
      try {
        const res = await fetch(`/api/cost-catalog/v2?limit=500`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const arr: Array<{ csi_code: string; description?: string | null }> = Array.isArray(
          data?.items,
        )
          ? data.items
          : Array.isArray(data)
            ? data
            : [];
        if (cancelled) return;
        const seen = new Set<string>();
        const opts: CodeOption[] = [];
        for (const r of arr) {
          if (!r?.csi_code || seen.has(r.csi_code)) continue;
          seen.add(r.csi_code);
          opts.push({ csi_code: r.csi_code, description: r.description ?? null });
        }
        setCodes(opts);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingCodes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const variance = useMemo(() => {
    const observed: number[] = [];
    for (const r of items) {
      if (
        r.actual_unit_cost != null &&
        r.estimated_unit_cost != null &&
        r.estimated_unit_cost > 0
      ) {
        const v = ((r.actual_unit_cost - r.estimated_unit_cost) / r.estimated_unit_cost) * 100;
        observed.push(v);
      }
    }
    const count = items.length;
    const avg =
      observed.length > 0
        ? observed.reduce((a, b) => a + b, 0) / observed.length
        : null;
    return { count, observedCount: observed.length, avg };
  }, [items]);

  const bulkImport = useBulkImport<ActualPayload>(projectId, {
    endpoint: "/api/cost-catalog/actuals",
    mapRow: (row, pid) => {
      const code = toStr(row.csi_code) ?? toStr(row["CSI Code"]) ?? toStr(row.code);
      const actual =
        toNum(row.actual_unit_cost) ??
        toNum(row["Actual Unit Cost"]) ??
        toNum(row.actual);
      if (!code || actual === null) return null;
      return {
        project_id: pid,
        csi_code: code,
        quantity:
          toNum(row.quantity) ?? toNum(row.qty) ?? toNum(row["Quantity"]) ?? null,
        actual_unit_cost: actual,
        estimated_unit_cost:
          toNum(row.estimated_unit_cost) ??
          toNum(row["Estimated Unit Cost"]) ??
          toNum(row.estimated) ??
          null,
      };
    },
    onComplete: (created) => {
      if (created > 0) void loadActuals();
    },
  });

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!csiCode.trim()) {
      toast({ title: "Pick a CSI code", kind: "error" });
      return;
    }
    const actual = Number(actualCost);
    if (!Number.isFinite(actual) || actual < 0) {
      toast({ title: "Actual unit cost is required", kind: "error" });
      return;
    }
    const qty = quantity.trim() === "" ? null : Number(quantity);
    const est = estimatedCost.trim() === "" ? null : Number(estimatedCost);

    setSaving(true);
    try {
      const payload: ActualPayload = {
        project_id: projectId,
        csi_code: csiCode.trim(),
        quantity: qty !== null && Number.isFinite(qty) ? qty : null,
        actual_unit_cost: actual,
        estimated_unit_cost: est !== null && Number.isFinite(est) ? est : null,
      };
      const res = await fetch("/api/cost-catalog/actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast({ title: "Actual recorded", kind: "success" });
      setCsiCode("");
      setQuantity("");
      setActualCost("");
      setEstimatedCost("");
      void loadActuals();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: msg, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryStat label="Observations" value={variance.count.toString()} />
        <SummaryStat
          label="With Comparison"
          value={variance.observedCount.toString()}
        />
        <SummaryStat
          label="Avg Variance"
          value={variance.avg === null ? "—" : `${variance.avg >= 0 ? "+" : ""}${variance.avg.toFixed(1)}%`}
          tone={
            variance.avg === null
              ? "neutral"
              : variance.avg > 5
                ? "warn"
                : variance.avg < -5
                  ? "good"
                  : "neutral"
          }
        />
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="inline-flex rounded-full border border-white/10 bg-[#08090C] p-0.5">
            <button
              type="button"
              onClick={() => setMode("quick")}
              className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition ${
                mode === "quick"
                  ? "bg-[#CCFF00] text-black"
                  : "text-white/55 hover:text-white"
              }`}
            >
              Quick Add
            </button>
            <button
              type="button"
              onClick={() => setMode("bulk")}
              className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition ${
                mode === "bulk"
                  ? "bg-[#CCFF00] text-black"
                  : "text-white/55 hover:text-white"
              }`}
            >
              Bulk Import
            </button>
          </div>
        </div>

        {mode === "quick" ? (
          <form onSubmit={quickAdd} className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                CSI Code
              </label>
              <select
                value={csiCode}
                onChange={(e) => setCsiCode(e.target.value)}
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-2 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              >
                <option value="">
                  {loadingCodes ? "Loading…" : "Select a code"}
                </option>
                {codes.map((c) => (
                  <option key={c.csi_code} value={c.csi_code}>
                    {c.csi_code}
                    {c.description ? ` — ${c.description}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Quantity
              </label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Actual $/Unit
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Estimated $/Unit
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>
            <div className="md:col-span-5 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {saving ? "Recording…" : "Record Actual"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/55">
              Upload a CSV/XLSX with columns:{" "}
              <span className="font-mono text-[#CCFF00]">csi_code</span>,{" "}
              <span className="font-mono text-[#CCFF00]">actual_unit_cost</span>,{" "}
              <span className="font-mono text-white/70">quantity</span>,{" "}
              <span className="font-mono text-white/70">estimated_unit_cost</span>{" "}
              (last two optional).
            </p>
            <UniversalImportButton
              onParsed={(parsed) => void bulkImport(parsed)}
              hint="cost-actuals"
              label="Import Actuals"
              caption="CSV, XLSX"
            />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#0E0F12] overflow-hidden">
        <div className="border-b border-white/8 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/45">
          Recorded Actuals ({items.length})
        </div>
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/40">
            No actuals recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-[10px] uppercase tracking-widest text-white/45">
                  <th className="px-4 py-3 text-left">CSI Code</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Actual $/Unit</th>
                  <th className="px-4 py-3 text-right">Estimated $/Unit</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const v =
                    row.actual_unit_cost != null &&
                    row.estimated_unit_cost != null &&
                    row.estimated_unit_cost > 0
                      ? ((row.actual_unit_cost - row.estimated_unit_cost) /
                          row.estimated_unit_cost) *
                        100
                      : row.variance_pct ?? null;
                  const tone =
                    v === null
                      ? "text-white/40"
                      : v > 5
                        ? "text-amber-300"
                        : v < -5
                          ? "text-emerald-300"
                          : "text-white/60";
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-white/5 text-white/80 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-mono text-[#CCFF00]">
                        {row.csi_code}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.quantity ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ${row.actual_unit_cost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white/55">
                        {row.estimated_unit_cost != null
                          ? `$${row.estimated_unit_cost.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${tone}`}>
                        {v === null
                          ? "—"
                          : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-white";
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}
