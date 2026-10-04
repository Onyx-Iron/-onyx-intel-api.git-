"use client";

import { useEffect, useState } from "react";

interface BudgetRow {
  cost_code: string;
  original: number;
  approved_changes: number;
  committed: number;
  actual: number;
}

function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/** Read-only. The pricing matrix remains the only editor of estimate lines. */
export default function CostCodeBudget({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/estimate/cost-code-budget?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { rows?: BudgetRow[]; error?: string };
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Cost code budget is unavailable");
        return;
      }
      setRows(data.rows ?? []);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <section className="border-b border-white/10 px-4 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-mono text-white/40">Cost code budget</div>
      {error && <p className="text-[11px] text-amber-300">{error}</p>}
      {!error && rows.length === 0 && <p className="text-[11px] text-white/40">No estimate, change, purchase order, or invoice money yet.</p>}
      {rows.length > 0 && (
        <table className="w-full text-left text-[11px]">
          <thead className="text-[9px] uppercase tracking-widest text-white/40">
            <tr>
              <th className="py-1 pr-3">Cost code</th>
              <th className="py-1 pr-3 text-right">Original</th>
              <th className="py-1 pr-3 text-right">Approved changes</th>
              <th className="py-1 pr-3 text-right">Committed</th>
              <th className="py-1 text-right">Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cost_code} className="border-t border-white/5">
                <td className="py-1 pr-3 font-mono">{row.cost_code}</td>
                <td className="py-1 pr-3 text-right">{money(row.original)}</td>
                <td className="py-1 pr-3 text-right">{money(row.approved_changes)}</td>
                <td className="py-1 pr-3 text-right">{money(row.committed)}</td>
                <td className="py-1 text-right">{money(row.actual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
