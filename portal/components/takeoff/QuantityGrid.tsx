"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { lookupCsi } from "@/lib/estimating/csi-catalog";
import { groupQuantitiesByDivision, type QuantityGridRow } from "@/lib/takeoff/quantity-grid";

interface ApiItem {
  id: string;
  label: string | null;
  csi_code: string | null;
  division: string | null;
  quantity: number | null;
  unit: string | null;
  page: number | null;
  sheet_id: string | null;
  document_id: string | null;
  type?: string | null;
  meta?: Record<string, unknown> | null;
}

export default function QuantityGrid({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<QuantityGridRow[]>([]);

  const load = useCallback(() => {
    fetch(`/api/takeoff/items?project_id=${encodeURIComponent(projectId)}&limit=200`)
      .then((res) => res.json())
      .then((data: { items?: ApiItem[] }) => {
        setRows((data.items ?? []).map((item) => ({
          id: item.id,
          label: item.label ?? "Untitled",
          csiCode: item.csi_code,
          division: item.division,
          quantity: item.quantity,
          unit: item.unit,
          pageNumber: item.page,
          pageId: item.sheet_id,
          documentId: item.document_id,
        })));
      })
      .catch(() => setRows([]));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function save(row: QuantityGridRow, patch: { label?: string; csiCode?: string }) {
    const next = { ...row, ...patch };
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...patch } : item));
    await fetch("/api/takeoff/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        rows: [{
          id: row.id,
          label: next.label,
          csi_code: next.csiCode,
          division: (next.csiCode ?? "").replace(/\D/g, "").slice(0, 2) || row.division,
          quantity: row.quantity,
          unit: row.unit,
          page: row.pageNumber,
          document_id: row.documentId,
        }],
      }),
    });
  }

  const groups = groupQuantitiesByDivision(rows, (code) => lookupCsi(code).division?.name ?? `Division ${code}`);
  if (groups.length === 0) return null;

  return (
    <div className="mb-3 max-h-64 overflow-y-auto rounded border border-white/10 bg-black/30 p-2">
      <div className="text-[9px] uppercase tracking-widest text-white/35">Quantity grid</div>
      {groups.map((group) => (
        <div key={group.division} className="mt-2">
          <div className="flex items-baseline justify-between gap-2 text-[10px] text-white/70">
            <span className="font-mono">{group.division} {group.name}</span>
            <span className="font-mono text-white/40">
              {group.subtotals.map((sub) => `${sub.quantity.toFixed(2)} ${sub.unit}`).join(" · ")}
            </span>
          </div>
          {group.rows.map((row) => (
            <div key={row.id} className="mt-1 grid grid-cols-[1fr_72px_auto] items-center gap-1">
              <input
                value={row.label}
                onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, label: event.target.value } : item))}
                onBlur={(event) => { void save(row, { label: event.target.value }); }}
                className="min-w-0 bg-transparent text-[11px] text-white focus:outline-none"
              />
              <input
                value={row.csiCode ?? ""}
                onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, csiCode: event.target.value } : item))}
                onBlur={(event) => { void save(row, { csiCode: event.target.value }); }}
                placeholder="CSI"
                className="bg-transparent font-mono text-[10px] text-white/70 focus:outline-none"
              />
              <div className="text-right font-mono text-[10px] text-white/80">
                {row.quantity == null ? "—" : row.quantity.toFixed(2)} {row.unit ?? ""}
                {row.pageId ? (
                  <Link
                    href={`/dashboard/projects/${projectId}/takeoff/canvas?page_id=${encodeURIComponent(row.pageId)}`}
                    className="ml-1 text-[#CCFF00]"
                  >
                    p{row.pageNumber || ""}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
