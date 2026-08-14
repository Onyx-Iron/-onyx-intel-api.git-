"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import AIAccuracyNotice from "@/components/common/AIAccuracyNotice";

import { useConfirm } from "@/components/common/ConfirmDialog";

interface CatalogItem {
  id: string;
  csi_code: string | null;
  description: string;
  trade: string | null;
  uom: string | null;
  unit_cost: number;
}

interface FormState {
  csi_code: string; description: string; trade: string; uom: string; unit_cost: string;
}

interface PriceEvidence {
  id: string;
  description: string;
  cost_code: string | null;
  source_kind: string;
  source_ref: string | null;
  effective_date: string;
  unit: string;
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  subcontract_cost: number;
  other_cost: number;
  tax_cost: number;
  freight_cost: number;
  waste_cost: number;
  escalation_cost: number;
  confidence: number;
}

interface ProjectOption { id: string; name: string }
interface EvidenceForm {
  project_id: string; cost_code: string; trade_key: string; description: string;
  source_kind: "project_quote" | "company_actual" | "historical_project" | "licensed_dataset" | "public_index" | "local_market" | "ai_estimate";
  source_ref: string; effective_date: string; expires_at: string; unit: string;
  labor_cost: string; material_cost: string; equipment_cost: string; subcontract_cost: string;
  other_cost: string; tax_cost: string; freight_cost: string; waste_cost: string; escalation_cost: string;
  confidence: string;
}

const EMPTY_EVIDENCE: EvidenceForm = {
  project_id: "", cost_code: "", trade_key: "", description: "", source_kind: "company_actual",
  source_ref: "", effective_date: new Date().toISOString().slice(0, 10), expires_at: "", unit: "EA",
  labor_cost: "", material_cost: "", equipment_cost: "", subcontract_cost: "", other_cost: "",
  tax_cost: "", freight_cost: "", waste_cost: "", escalation_cost: "", confidence: "0.80",
};

const EMPTY: FormState = { csi_code: "", description: "", trade: "", uom: "", unit_cost: "" };

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceBookManager() {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [evidence, setEvidence] = useState<PriceEvidence[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState<EvidenceForm>(EMPTY_EVIDENCE);
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/cost-catalog").then((r) => r.json()),
      fetch("/api/construction-intelligence/prices/review-queue", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/projects?limit=200").then((r) => r.json()),
    ]).then(([catalog, queue, projectList]: [{ items?: CatalogItem[] }, { observations?: PriceEvidence[] }, { projects?: ProjectOption[] }]) => {
      setItems(catalog.items ?? []);
      setEvidence(queue.observations ?? []);
      setProjects(projectList.projects ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openAdd = () => { setEditId(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (it: CatalogItem) => {
    setEditId(it.id);
    setForm({ csi_code: it.csi_code ?? "", description: it.description, trade: it.trade ?? "", uom: it.uom ?? "", unit_cost: String(it.unit_cost) });
    setShowForm(true);
  };
  const cancel = () => { setShowForm(false); setEditId(null); setForm(EMPTY); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    setSubmitting(true);
    const payload = {
      csi_code: form.csi_code || null, description: form.description.trim(),
      trade: form.trade || null, uom: form.uom || null, unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : 0,
    };
    try {
      if (editId) await fetch(`/api/cost-catalog/${encodeURIComponent(editId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      else await fetch("/api/cost-catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      cancel(); load();
    } finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: String("Delete this price-book entry?"), destructive: true }))) return;
    const prevItems = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/cost-catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setItems(prevItems);
        load();
      }
    } catch {
      setItems(prevItems);
      load();
    }
  };

  const reviewEvidence = async (item: PriceEvidence, decision: "approved" | "rejected") => {
    const reason = (reviewReasons[item.id] ?? "").trim();
    if (decision === "rejected" && reason.length < 3) {
      setReviewMessage("Enter a rejection reason before rejecting evidence.");
      return;
    }
    setReviewingId(item.id);
    setReviewMessage(null);
    try {
      const previewRes = await fetch(`/api/construction-intelligence/prices/${encodeURIComponent(item.id)}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const previewData = await previewRes.json().catch(() => ({})) as { error?: string; preview?: { id: string; payload_hash: string } };
      if (!previewRes.ok || !previewData.preview) throw new Error(previewData.error ?? "Could not prepare the review.");
      setReviewingId(null);
      const total = item.labor_cost + item.material_cost + item.equipment_cost + item.subcontract_cost
        + item.other_cost + item.tax_cost + item.freight_cost + item.waste_cost + item.escalation_cost;
      const accepted = await confirm({
        title: `${decision === "approved" ? "Approve" : "Reject"} this exact price evidence?`,
        description: `${item.source_kind.replaceAll("_", " ")} · ${item.source_ref ?? "No reference"} · $${money(total)}/${item.unit} · effective ${item.effective_date}. ${item.source_kind === "ai_estimate" ? "AI evidence remains non-authoritative even after review." : "Approval makes this source eligible for deterministic pricing."}`,
        confirmLabel: decision === "approved" ? "Approve evidence" : "Reject evidence",
        destructive: decision === "rejected",
      });
      if (!accepted) return;
      setReviewingId(item.id);
      const confirmRes = await fetch(`/api/construction-intelligence/prices/${encodeURIComponent(item.id)}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, preview_id: previewData.preview.id, preview_hash: previewData.preview.payload_hash }),
      });
      const confirmed = await confirmRes.json().catch(() => ({})) as { error?: string };
      if (!confirmRes.ok) throw new Error(confirmed.error ?? "Review confirmation failed.");
      setReviewMessage(`Price evidence ${decision}.`);
      load();
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Price review failed.");
    } finally {
      setReviewingId(null);
    }
  };

  const submitEvidence = async (event: React.FormEvent) => {
    event.preventDefault();
    setEvidenceSubmitting(true);
    setReviewMessage(null);
    try {
      const numeric = (value: string) => value.trim() === "" ? 0 : Number(value);
      const payload = {
        project_id: evidenceForm.project_id || null,
        cost_code: evidenceForm.cost_code || null,
        trade_key: evidenceForm.trade_key || null,
        description: evidenceForm.description.trim(), source_kind: evidenceForm.source_kind,
        source_ref: evidenceForm.source_ref.trim() || null, effective_date: evidenceForm.effective_date,
        expires_at: evidenceForm.expires_at || null, unit: evidenceForm.unit.trim().toUpperCase(),
        labor_cost: numeric(evidenceForm.labor_cost), material_cost: numeric(evidenceForm.material_cost),
        equipment_cost: numeric(evidenceForm.equipment_cost), subcontract_cost: numeric(evidenceForm.subcontract_cost),
        other_cost: numeric(evidenceForm.other_cost), tax_cost: numeric(evidenceForm.tax_cost),
        freight_cost: numeric(evidenceForm.freight_cost), waste_cost: numeric(evidenceForm.waste_cost),
        escalation_cost: numeric(evidenceForm.escalation_cost), confidence: Number(evidenceForm.confidence), assumptions: [],
      };
      const response = await fetch("/api/construction-intelligence/prices", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not add price evidence.");
      setEvidenceForm(EMPTY_EVIDENCE);
      setShowEvidenceForm(false);
      setReviewMessage("Price evidence added as unreviewed. Approve it below after checking the source.");
      load();
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Could not add price evidence.");
    } finally {
      setEvidenceSubmitting(false);
    }
  };

  const q = search.toLowerCase();
  const filtered = q
    ? items.filter((i) => i.description.toLowerCase().includes(q) || (i.csi_code ?? "").toLowerCase().includes(q) || (i.trade ?? "").toLowerCase().includes(q))
    : items;

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Price Book"
        description='Your reusable unit-cost library. Estimates can pull from here with one click.'
        compact
        actions={
          <button onClick={openAdd} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85">
            <Plus size={13} /> Add
          </button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8 max-w-5xl">
      <AIAccuracyNotice context="pricing" className="mb-4 rounded-xl" />
      <div className="mb-6 rounded-xl border border-white/10 bg-[#16161A] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#CCFF00]">Evidence review</p>
            <p className="mt-1 text-xs text-gray-500">Human approval is required before imported prices can become financial values.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-gray-400">{evidence.length} pending</span>
            <button onClick={() => setShowEvidenceForm((value) => !value)} className="rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00]">{showEvidenceForm ? "Cancel" : "Add evidence"}</button>
          </div>
        </div>
        {reviewMessage && <p role="status" className="mb-3 text-xs text-amber-300">{reviewMessage}</p>}
        {showEvidenceForm && <form onSubmit={submitEvidence} className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/20 p-4 md:grid-cols-4">
          <input required value={evidenceForm.description} onChange={(e) => setEvidenceForm((f) => ({ ...f, description: e.target.value }))} className={`${inputCls} md:col-span-2`} placeholder="Description *" />
          <input value={evidenceForm.cost_code} onChange={(e) => setEvidenceForm((f) => ({ ...f, cost_code: e.target.value }))} className={inputCls} placeholder="CSI / cost code" />
          <input value={evidenceForm.trade_key} onChange={(e) => setEvidenceForm((f) => ({ ...f, trade_key: e.target.value }))} className={inputCls} placeholder="Trade" />
          <select aria-label="Price source type" value={evidenceForm.source_kind} onChange={(e) => setEvidenceForm((f) => ({ ...f, source_kind: e.target.value as EvidenceForm["source_kind"] }))} className={inputCls}>
            <option value="project_quote">Project quote</option><option value="company_actual">Company actual</option><option value="historical_project">Historical project</option><option value="licensed_dataset">Licensed dataset</option><option value="public_index">Public index</option><option value="local_market">Local market</option><option value="ai_estimate">AI estimate (provisional)</option>
          </select>
          <select aria-label="Price evidence project" value={evidenceForm.project_id} onChange={(e) => setEvidenceForm((f) => ({ ...f, project_id: e.target.value }))} className={inputCls}>
            <option value="">Company-wide / no project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <input required={evidenceForm.source_kind !== "ai_estimate"} value={evidenceForm.source_ref} onChange={(e) => setEvidenceForm((f) => ({ ...f, source_ref: e.target.value }))} className={inputCls} placeholder="Quote, invoice, URL, or dataset reference" />
          <input required value={evidenceForm.unit} onChange={(e) => setEvidenceForm((f) => ({ ...f, unit: e.target.value }))} className={inputCls} placeholder="Unit (SF, CY, EA...)" />
          <input required type="date" value={evidenceForm.effective_date} onChange={(e) => setEvidenceForm((f) => ({ ...f, effective_date: e.target.value }))} className={inputCls} />
          <input type="date" value={evidenceForm.expires_at} onChange={(e) => setEvidenceForm((f) => ({ ...f, expires_at: e.target.value }))} className={inputCls} />
          {(["labor_cost", "material_cost", "equipment_cost", "subcontract_cost", "other_cost", "tax_cost", "freight_cost", "waste_cost", "escalation_cost"] as const).map((field) => <input key={field} type="number" min="0" step="any" value={evidenceForm[field]} onChange={(e) => setEvidenceForm((f) => ({ ...f, [field]: e.target.value }))} className={inputCls} placeholder={`${field.replaceAll("_", " ")} / unit`} />)}
          <input type="number" min="0" max="1" step="0.01" value={evidenceForm.confidence} onChange={(e) => setEvidenceForm((f) => ({ ...f, confidence: e.target.value }))} className={inputCls} placeholder="Confidence 0–1" />
          <div className="md:col-span-4"><button type="submit" disabled={evidenceSubmitting} className="rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:opacity-50">{evidenceSubmitting ? "Adding…" : "Add for human review"}</button></div>
        </form>}
        {evidence.length === 0 ? (
          <p className="py-4 text-center text-xs uppercase tracking-widest text-gray-600">No price evidence is awaiting review</p>
        ) : (
          <div className="space-y-3">
            {evidence.map((item) => {
              const total = item.labor_cost + item.material_cost + item.equipment_cost + item.subcontract_cost
                + item.other_cost + item.tax_cost + item.freight_cost + item.waste_cost + item.escalation_cost;
              return <div key={item.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.description}</p>
                    <p className="mt-1 text-xs text-gray-500">{item.cost_code ?? "No cost code"} · {item.source_kind.replaceAll("_", " ")} · {item.source_ref ?? "No source reference"} · effective {item.effective_date}</p>
                  </div>
                  <p className="font-mono text-sm font-bold text-[#CCFF00]">${money(total)}/{item.unit}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input aria-label={`Review reason for ${item.description}`} value={reviewReasons[item.id] ?? ""}
                    onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    className={`${inputCls} min-w-[240px] flex-1`} placeholder="Review note (required for rejection)" />
                  <button disabled={reviewingId === item.id} onClick={() => void reviewEvidence(item, "approved")} className="rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:opacity-50">Approve</button>
                  <button disabled={reviewingId === item.id} onClick={() => void reviewEvidence(item, "rejected")} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-300 disabled:opacity-50">Reject</button>
                </div>
              </div>;
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-700" />
          <input aria-label="Search price book" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by description, CSI, trade..." className={`${inputCls} pl-8`} />
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
          <Plus size={11} /> Add Entry
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#16161A] p-6 mb-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">{editId ? "Edit Entry" : "New Entry"}</p>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">CSI Code</label><input value={form.csi_code} onChange={(e) => setForm((f) => ({ ...f, csi_code: e.target.value }))} className={`${inputCls} font-mono`} placeholder="03-30-00" /></div>
          <div className="md:col-span-2"><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Description *</label><input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="e.g. 4&quot; slab on grade" /></div>
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">UOM</label><input value={form.uom} onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))} className={inputCls} placeholder="SF" /></div>
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Unit Cost ($)</label><input type="number" step="any" min="0" value={form.unit_cost} onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))} className={`${inputCls} font-mono`} placeholder="0.00" /></div>
            <div className="md:col-span-5 flex items-center gap-3 pt-1">
              <button type="submit" disabled={submitting} className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">{submitting ? "Saving..." : editId ? "Save" : "Add"}</button>
              <button type="button" onClick={cancel} className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#16161A] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["CSI Code", "Description", "UOM", "Unit Cost", ""].map((h) => <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                [...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((__, j) => <td key={j} className="px-4 py-3"><div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: j === 1 ? "70%" : "40%" }} /></td>)}</tr>)
              ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-16 text-xs uppercase tracking-widest text-gray-600">{items.length === 0 ? "Your price book is empty - add entries or save prices from an estimate." : "No matches"}</td></tr>
              ) : (
                filtered.map((it) => (
                  <tr key={it.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{it.csi_code ?? "-"}</td>
                    <td className="px-4 py-3 text-white text-xs">{it.description}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{it.uom ?? "-"}</td>
                    <td className="px-4 py-3 text-[#CCFF00] text-xs font-mono font-bold">${money(it.unit_cost)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(it)} aria-label="Edit entry" className="min-h-[40px] text-gray-600 hover:text-white transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                        <button onClick={() => remove(it.id)} aria-label="Delete entry" className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}
