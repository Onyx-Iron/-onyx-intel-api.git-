"use client";

import { useEffect, useState } from "react";
import type { ToolKind } from "@/lib/takeoff/canvas/tool-chest";

export interface ChestTool {
  id: string;
  name: string;
  cost_code: string;
  unit: string;
  tool: ToolKind;
}

export default function ToolChestPanel({
  projectId,
  armedId,
  onArm,
}: {
  projectId: string;
  armedId: string | null;
  onArm: (tool: ChestTool) => void;
}) {
  const [tools, setTools] = useState<ChestTool[]>([]);
  const [name, setName] = useState("");
  const [costCode, setCostCode] = useState("");
  const [tool, setTool] = useState<ToolKind>("count");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/takeoff/tools?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = await res.json() as { tools?: ChestTool[] };
      if (!cancelled) setTools(data.tools ?? []);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  async function addTool() {
    setError(null);
    const unit = tool === "count" ? "EA" : tool === "area" ? "SF" : "LF";
    const res = await fetch("/api/takeoff/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        name,
        cost_code: costCode,
        unit,
        tool,
      }),
    });
    const data = await res.json().catch(() => ({})) as { tool?: ChestTool; error?: string };
    if (!res.ok || !data.tool) {
      setError(data.error ?? "Could not save the tool");
      return;
    }
    setTools((prev) => [...prev, data.tool as ChestTool]);
    setName("");
    setCostCode("");
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-white/40">Tool chest</div>
      <div className="flex flex-col gap-1">
        {tools.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onArm(item)}
            className={`rounded-lg border px-2 py-1 text-left text-[11px] ${
              armedId === item.id
                ? "border-[#CCFF00]/70 bg-[#CCFF00]/10 text-[#CCFF00]"
                : "border-white/10 text-white/70 hover:text-white"
            }`}
          >
            <span className="font-mono">{item.cost_code}</span>
            <span className="ml-2">{item.name}</span>
            <span className="ml-2 uppercase text-white/40">{item.tool}</span>
          </button>
        ))}
        {tools.length === 0 && <p className="text-[11px] text-white/40">Add a count, length, or area with a CSI code.</p>}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tool name"
        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px]"
      />
      <div className="flex gap-1">
        <input
          value={costCode}
          onChange={(e) => setCostCode(e.target.value)}
          placeholder="NN-NN-NN"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px]"
        />
        <select
          value={tool}
          onChange={(e) => setTool(e.target.value as ToolKind)}
          className="rounded border border-white/10 bg-black/40 px-1 text-[11px]"
        >
          <option value="count">Count</option>
          <option value="length">Length</option>
          <option value="area">Area</option>
        </select>
      </div>
      <button
        type="button"
        onClick={() => { void addTool(); }}
        className="w-full rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/60 hover:text-white"
      >
        Save tool
      </button>
      {error && <p className="text-[11px] text-amber-300">{error}</p>}
    </div>
  );
}
