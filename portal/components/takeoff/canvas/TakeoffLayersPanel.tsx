"use client";

import { useCallback, useEffect, useState } from "react";

export interface TakeoffLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export default function TakeoffLayersPanel({
  projectId,
  activeLayerId,
  onActiveLayerChange,
  onVisibilityChange,
}: {
  projectId: string;
  activeLayerId: string | null;
  onActiveLayerChange: (id: string | null) => void;
  onVisibilityChange?: (layers: TakeoffLayer[]) => void;
}) {
  const [layers, setLayers] = useState<TakeoffLayer[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyLayers = useCallback((list: TakeoffLayer[]) => {
    setLayers(list);
    onVisibilityChange?.(list);
    if (!activeLayerId && list[0]) onActiveLayerChange(list[0].id);
  }, [activeLayerId, onActiveLayerChange, onVisibilityChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/takeoff/layers?project_id=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setLoadError(`Failed to load layers (${res.status})`);
          return;
        }
        const data = await res.json() as { layers?: TakeoffLayer[] };
        if (!cancelled) {
          setLoadError(null);
          applyLayers(data.layers ?? []);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load layers");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- project-scoped mount load
  }, [projectId]);

  const reload = async () => {
    const res = await fetch(`/api/takeoff/layers?project_id=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json() as { layers?: TakeoffLayer[] };
    applyLayers(data.layers ?? []);
  };

  const toggle = async (layer: TakeoffLayer, field: "visible" | "locked") => {
    const res = await fetch("/api/takeoff/layers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: layer.id, [field]: !layer[field] }),
    });
    if (res.ok) await reload();
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/takeoff/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, name: name.trim() }),
      });
      if (res.ok) {
        setName("");
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">Layers</p>
      {loadError && <p className="mb-2 text-[10px] text-amber-200/80">{loadError}</p>}
      <ul className="mb-2 max-h-48 space-y-1 overflow-y-auto">
        {layers.map((l) => (
          <li key={l.id} className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onActiveLayerChange(l.id)}
              className={`h-2.5 w-2.5 rounded-full border ${
                activeLayerId === l.id ? "border-white" : "border-transparent"
              }`}
              style={{ background: l.color }}
              title="Active draw layer"
            />
            <button
              type="button"
              onClick={() => onActiveLayerChange(l.id)}
              className={`min-w-0 flex-1 truncate text-left ${
                activeLayerId === l.id ? "text-white" : "text-white/55 hover:text-white"
              }`}
            >
              {l.name}
            </button>
            <button
              type="button"
              onClick={() => void toggle(l, "visible")}
              className="text-[10px] text-white/40 hover:text-white"
              title="Visibility (filter only — never mutates quantities)"
            >
              {l.visible ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => void toggle(l, "locked")}
              className="text-[10px] text-white/40 hover:text-white"
            >
              {l.locked ? "lock" : "edit"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New layer"
          className="flex-1 rounded border border-white/10 bg-black/50 px-2 py-1 text-[11px] text-white"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
          className="rounded bg-white/10 px-2 py-1 text-[10px] text-white/70 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
