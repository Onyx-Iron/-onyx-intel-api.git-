"use client";

import { useEffect, useState } from "react";
import { expandAssemblyPlacement } from "@/lib/takeoff/canvas/assemblies";

interface AsmComp {
  cost_code: string;
  quantity_factor: number;
  unit: string;
  label: string | null;
}

interface Assembly {
  id: string;
  name: string;
  csi_code: string;
  components: AsmComp[];
}

export default function PlaceAssemblyPanel({
  onPlace,
}: {
  onPlace: (rows: ReturnType<typeof expandAssemblyPlacement>) => void;
}) {
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("1");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/takeoff/assemblies");
      if (!res.ok) return;
      const data = await res.json() as { assemblies?: Assembly[]; hint?: string };
      if (cancelled) return;
      setAssemblies(data.assemblies ?? []);
      if (data.hint) setHint(data.hint);
      if (data.assemblies?.[0]) setSelectedId(data.assemblies[0].id);
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = assemblies.find((a) => a.id === selectedId);

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Place assembly</p>
      {hint && assemblies.length === 0 && (
        <p className="text-[10px] text-white/35">{hint}</p>
      )}
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full rounded border border-white/10 bg-black/50 px-2 py-1 text-[11px] text-white"
      >
        {assemblies.length === 0 && <option value="">No assemblies</option>}
        {assemblies.map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.components.length})</option>
        ))}
      </select>
      <div className="flex gap-1">
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-16 rounded border border-white/10 bg-black/50 px-2 py-1 text-[11px] text-white"
          title="Base quantity"
        />
        <button
          type="button"
          disabled={!selected || selected.components.length === 0}
          onClick={() => {
            if (!selected) return;
            const rows = expandAssemblyPlacement({
              assemblyId: selected.id,
              assemblyName: selected.name,
              baseQuantity: Number(qty) || 1,
              components: selected.components.map((c) => ({
                cost_code: c.cost_code,
                quantity_factor: c.quantity_factor,
                unit: c.unit,
                label: c.label,
              })),
            });
            onPlace(rows);
          }}
          className="flex-1 rounded bg-[#CCFF00]/20 px-2 py-1 text-[10px] font-semibold text-[#CCFF00] disabled:opacity-40"
        >
          Expand → takeoff
        </button>
      </div>
    </div>
  );
}
