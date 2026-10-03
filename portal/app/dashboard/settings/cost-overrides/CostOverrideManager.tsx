"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Plus, Search, X } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";

interface CostOverride {
  id: string;
  csi_code: string;
  description: string | null;
  region_code: string | null;
  unit: string | null;
  unit_cost: number;
  labor_cost: number | null;
  material_cost: number | null;
  equipment_cost: number | null;
  notes: string | null;
}

interface CodeOption {
  csi_code: string;
  description: string | null;
}

interface FormState {
  id: string | null;
  csi_code: string;
  description: string;
  region_code: string;
  unit: string;
  unit_cost: string;
  labor_cost: string;
  material_cost: string;
  equipment_cost: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  csi_code: "",
  description: "",
  region_code: "",
  unit: "",
  unit_cost: "",
  labor_cost: "",
  material_cost: "",
  equipment_cost: "",
  notes: "",
};

interface Props {
  tenantId: string;
  planLabel: string;
}

export default function CostOverrideManager({ tenantId, planLabel }: Props) {
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [items, setItems] = useState<CostOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nationalPrices, setNationalPrices] = useState<Record<string, number>>({});

  // Typeahead state
  const [codeQuery, setCodeQuery] = useState("");
  const [codeOptions, setCodeOptions] = useState<CodeOption[]>([]);
  const [showCodeDropdown, setShowCodeDropdown] = useState(false);
  const codeFetchAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cost-catalog/overrides", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items?: unknown[]; overrides?: unknown[] };
      const raw: unknown[] = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.overrides)
          ? data.overrides
          : [];
      const rows: CostOverride[] = raw.map((entry) => {
        const r = entry as {
          id: string;
          region_code?: string | null;
          unit_cost: number;
          labor_cost?: number | null;
          material_cost?: number | null;
          equipment_cost?: number | null;
          notes?: string | null;
          cost_codes?: { csi_code?: string; description?: string | null; uom?: string | null } | null;
          csi_code?: string;
          description?: string | null;
          unit?: string | null;
        };
        return {
          id: r.id,
          csi_code: r.cost_codes?.csi_code ?? r.csi_code ?? "",
          description: r.cost_codes?.description ?? r.description ?? null,
          region_code: r.region_code ?? null,
          unit: r.cost_codes?.uom ?? r.unit ?? null,
          unit_cost: r.unit_cost,
          labor_cost: r.labor_cost ?? null,
          material_cost: r.material_cost ?? null,
          equipment_cost: r.equipment_cost ?? null,
          notes: r.notes ?? null,
        };
      });
      setItems(rows);
      // Fetch national reference prices for vs. National column
      const codes = Array.from(new Set(rows.map((r) => r.csi_code))).filter(Boolean);
      if (codes.length > 0) {
        try {
          const params = new URLSearchParams({ cost_codes: codes.join(",") });
          const ref = await fetch(`/api/cost-catalog/v2?${params.toString()}`, {
            cache: "no-store",
          });
          if (ref.ok) {
            const refData = await ref.json();
            const arr: Array<{ csi_code: string; unit_cost: number }> = Array.isArray(
              refData?.items,
            )
              ? refData.items
              : Array.isArray(refData)
                ? refData
                : [];
            const map: Record<string, number> = {};
            for (const x of arr) {
              if (x?.csi_code && typeof x.unit_cost === "number") {
                map[x.csi_code] = x.unit_cost;
              }
            }
            setNationalPrices(map);
          }
        } catch {
          // National pricing is best-effort; ignore failures.
        }
      } else {
        setNationalPrices({});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load overrides";
      toast({ title: msg, kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // CSI code typeahead — debounced
  useEffect(() => {
    if (!showCodeDropdown) return;
    const q = codeQuery.trim();
    if (q.length < 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodeOptions([]);
      return;
    }
    if (codeFetchAbort.current) codeFetchAbort.current.abort();
    const ctrl = new AbortController();
    codeFetchAbort.current = ctrl;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "12" });
        const res = await fetch(`/api/cost-catalog/v2?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const arr: Array<{ csi_code: string; description?: string | null }> = Array.isArray(
          data?.items,
        )
          ? data.items
          : Array.isArray(data)
            ? data
            : [];
        const seen = new Set<string>();
        const opts: CodeOption[] = [];
        for (const r of arr) {
          if (!r?.csi_code || seen.has(r.csi_code)) continue;
          seen.add(r.csi_code);
          opts.push({ csi_code: r.csi_code, description: r.description ?? null });
        }
        setCodeOptions(opts);
      } catch {
        // ignore aborted/failed lookups
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [codeQuery, showCodeDropdown]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) =>
        r.csi_code.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.region_code ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setCodeQuery("");
    setShowForm(true);
  }

  function openEdit(row: CostOverride) {
    setForm({
      id: row.id,
      csi_code: row.csi_code,
      description: row.description ?? "",
      region_code: row.region_code ?? "",
      unit: row.unit ?? "",
      unit_cost: row.unit_cost?.toString() ?? "",
      labor_cost: row.labor_cost?.toString() ?? "",
      material_cost: row.material_cost?.toString() ?? "",
      equipment_cost: row.equipment_cost?.toString() ?? "",
      notes: row.notes ?? "",
    });
    setCodeQuery(row.csi_code);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setCodeQuery("");
    setCodeOptions([]);
  }

  function parseNum(s: string): number | null {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.csi_code.trim()) {
      toast({ title: "CSI code is required", kind: "error" });
      return;
    }
    const unitCost = parseNum(form.unit_cost);
    if (unitCost === null || unitCost < 0) {
      toast({ title: "Unit cost must be a positive number", kind: "error" });
      return;
    }

    setSaving(true);
    try {
      // API upserts on (tenant, cost_code, region) — POST covers create + edit.
      // There is no /overrides/[id] PATCH route.
      const payload = {
        cost_code: form.csi_code.trim(),
        region_code: form.region_code.trim() || null,
        unit_cost: unitCost,
        labor_cost: parseNum(form.labor_cost),
        material_cost: parseNum(form.material_cost),
        equipment_cost: parseNum(form.equipment_cost),
        notes: form.notes.trim() || null,
      };
      const isEdit = !!form.id;
      const res = await fetch("/api/cost-catalog/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast({
        title: isEdit ? "Override updated" : "Override saved",
        kind: "success",
      });
      closeForm();
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: msg, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: CostOverride) {
    const ok = await confirm({
      title: `Delete override for ${row.csi_code}?`,
      description: "This will revert projects to national pricing for this code.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/cost-catalog/overrides?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast({ title: "Override deleted", kind: "success" });
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ title: msg, kind: "error" });
    }
  }

  function vsNational(row: CostOverride): { label: string; tone: string } | null {
    const nat = nationalPrices[row.csi_code];
    if (!nat || nat <= 0) return null;
    const pct = ((row.unit_cost - nat) / nat) * 100;
    const sign = pct > 0 ? "+" : "";
    const tone =
      pct > 5
        ? "text-amber-300"
        : pct < -5
          ? "text-emerald-300"
          : "text-white/60";
    return { label: `${sign}${pct.toFixed(1)}%`, tone };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40">
          <span>Tenant ID</span>
          <span className="font-mono text-white/65">{tenantId.slice(0, 8)}…</span>
          <span className="ml-3 inline-flex h-5 items-center rounded-full border border-white/15 bg-white/5 px-2 text-[10px] font-bold uppercase">
            {planLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code or description"
              className="h-9 w-64 rounded-full border border-white/10 bg-[#0E0F12] pl-9 pr-3 text-xs text-white placeholder:text-white/30 focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add Override
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/8 bg-[#0E0F12] p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white">
              {form.id ? "Edit Override" : "New Override"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="rounded p-1 text-white/40 hover:bg-white/5 hover:text-white"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="relative">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                CSI Code *
              </label>
              <input
                value={codeQuery}
                onChange={(e) => {
                  setCodeQuery(e.target.value);
                  setForm((f) => ({ ...f, csi_code: e.target.value }));
                }}
                onFocus={() => setShowCodeDropdown(true)}
                onBlur={() => setTimeout(() => setShowCodeDropdown(false), 150)}
                placeholder="e.g. 03 30 00"
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                required
              />
              {showCodeDropdown && codeOptions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded border border-white/10 bg-[#0E0F12] shadow-lg">
                  {codeOptions.map((opt) => (
                    <button
                      key={opt.csi_code}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setForm((f) => ({
                          ...f,
                          csi_code: opt.csi_code,
                          description: opt.description ?? f.description,
                        }));
                        setCodeQuery(opt.csi_code);
                        setShowCodeDropdown(false);
                      }}
                      className="block w-full px-3 py-2 text-left text-xs text-white hover:bg-white/5"
                    >
                      <span className="font-mono text-[#CCFF00]">{opt.csi_code}</span>
                      {opt.description && (
                        <span className="ml-2 text-white/60">{opt.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Description
              </label>
              <input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Region Code (blank = All regions)
              </label>
              <input
                value={form.region_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, region_code: e.target.value }))
                }
                placeholder="e.g. CA, 90210, west"
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Unit
              </label>
              <input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="e.g. CY, LF, EA"
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Unit Cost *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unit_cost}
                onChange={(e) =>
                  setForm((f) => ({ ...f, unit_cost: e.target.value }))
                }
                className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-2 md:col-span-1">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Labor
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.labor_cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, labor_cost: e.target.value }))
                  }
                  className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-2 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Material
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.material_cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, material_cost: e.target.value }))
                  }
                  className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-2 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Equipment
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.equipment_cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, equipment_cost: e.target.value }))
                  }
                  className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-2 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded border border-white/10 bg-[#08090C] px-3 py-2 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-50"
            >
              {saving ? "Saving…" : form.id ? "Save Changes" : "Save Override"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-2xl border border-white/8 bg-[#0E0F12] overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-white/40">
            Loading overrides…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/40">
            {items.length === 0
              ? "No overrides yet. Add your first to start customizing pricing."
              : "No matches for your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-[10px] uppercase tracking-widest text-white/45">
                  <th className="px-4 py-3 text-left">CSI Code</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Region</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">vs. National</th>
                  <th className="px-4 py-3 text-left">L / M / E</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const vs = vsNational(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-white/5 text-white/80 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-mono text-[#CCFF00]">
                        {row.csi_code}
                      </td>
                      <td className="px-4 py-3">{row.description ?? "—"}</td>
                      <td className="px-4 py-3">
                        {row.region_code ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase">
                            {row.region_code}
                          </span>
                        ) : (
                          <span className="text-white/40">All regions</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ${row.unit_cost.toFixed(2)}
                        {row.unit && <span className="ml-1 text-white/40">/{row.unit}</span>}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${vs?.tone ?? "text-white/40"}`}>
                        {vs ? vs.label : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-white/55">
                        {row.labor_cost ?? "—"} / {row.material_cost ?? "—"} /{" "}
                        {row.equipment_cost ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-white/55 max-w-[200px] truncate">
                        {row.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded p-1.5 text-white/60 hover:bg-white/5 hover:text-white"
                            aria-label={`Edit ${row.csi_code}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(row)}
                            className="rounded p-1.5 text-white/60 hover:bg-red-500/10 hover:text-red-300"
                            aria-label={`Delete ${row.csi_code}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
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
