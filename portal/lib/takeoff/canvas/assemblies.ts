/**
 * Expand a cost assembly into multiple manual-takeoff draft rows
 * sharing a group key in meta (Company Hub M3).
 */

export interface AssemblyComponent {
  cost_code: string;
  label?: string | null;
  quantity_factor: number;
  unit: "EA" | "LF" | "SF" | string;
}

export interface ExpandedAssemblyRow {
  cost_code: string;
  label: string;
  quantity: number;
  unit: "EA" | "LF" | "SF";
  meta: { assembly_group: string; assembly_id: string; component_index: number };
}

function normalizeUnit(u: string): "EA" | "LF" | "SF" {
  const upper = u.toUpperCase();
  if (upper === "LF" || upper === "SF" || upper === "EA") return upper;
  return "EA";
}

export function expandAssemblyPlacement(opts: {
  assemblyId: string;
  assemblyName: string;
  components: AssemblyComponent[];
  baseQuantity: number;
}): ExpandedAssemblyRow[] {
  const group = `asm-${opts.assemblyId}-${Date.now().toString(36)}`;
  return opts.components.map((c, i) => ({
    cost_code: c.cost_code,
    label: c.label?.trim() || `${opts.assemblyName} · ${c.cost_code}`,
    quantity: Math.max(0, opts.baseQuantity * Number(c.quantity_factor || 0)),
    unit: normalizeUnit(c.unit),
    meta: {
      assembly_group: group,
      assembly_id: opts.assemblyId,
      component_index: i,
    },
  }));
}
