"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CircleDollarSign, ClipboardCheck, FileQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import { useBulkImport, toStr, toNum } from "@/components/common/useBulkImport";
import EmptyState from "@/components/common/EmptyState";

function pickCtrl(row: Record<string, string | number | null>, keys: string[]): string | null {
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[\s_-]/g, "");
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase().replace(/[\s_-]/g, "") === norm) {
        return rv == null ? null : String(rv);
      }
    }
  }
  return null;
}
import {
  CHANGE_ORDER_STATUSES,
  CONTROL_PRIORITIES,
  getControlSummary,
  RFI_STATUSES,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  type ChangeOrderStatus,
  type ControlPriority,
  type RfiStatus,
  type SubmittalStatus,
  type SubmittalType,
} from "@/lib/project-controls/schema";

import { useConfirm } from "@/components/common/ConfirmDialog";

type ControlKind = "rfi" | "submittal" | "change_order";

interface RfiItem {
  id: string;
  number: string | null;
  subject: string;
  description: string | null;
  discipline: string | null;
  status: RfiStatus;
  priority: ControlPriority;
  submitted_date: string | null;
  due_date: string | null;
  assigned_to: string | null;
  response: string | null;
  response_date: string | null;
}

interface SubmittalItem {
  id: string;
  number: string | null;
  spec_section: string | null;
  title: string;
  description: string | null;
  submittal_type: SubmittalType;
  status: SubmittalStatus;
  revision: string | null;
  submitted_date: string | null;
  due_date: string | null;
  returned_date: string | null;
  responsible: string | null;
  notes: string | null;
}

interface ChangeOrderItem {
  id: string;
  number: string | null;
  description: string;
  reason: string | null;
  status: ChangeOrderStatus;
  trade: string | null;
  request_date: string | null;
  submitted_date: string | null;
  approved_date: string | null;
  amount: number | string | null;
  labor_cost: number | string | null;
  material_cost: number | string | null;
  equipment_cost: number | string | null;
  subcontract_cost: number | string | null;
  markup: number | string | null;
  notes: string | null;
}

type ControlItem = RfiItem | SubmittalItem | ChangeOrderItem;
type FormState = Record<string, string>;

const CONTROL_TABS: Array<{ kind: ControlKind; label: string; endpoint: string }> = [
  { kind: "rfi", label: "RFIs", endpoint: "/api/rfis" },
  { kind: "submittal", label: "Submittals", endpoint: "/api/submittals" },
  { kind: "change_order", label: "Change Orders", endpoint: "/api/change-orders" },
];

const EMPTY_RFI_FORM: FormState = {
  number: "",
  subject: "",
  description: "",
  discipline: "",
  status: "open",
  priority: "medium",
  submitted_date: "",
  due_date: "",
  assigned_to: "",
  response: "",
  response_date: "",
};

const EMPTY_SUBMITTAL_FORM: FormState = {
  number: "",
  spec_section: "",
  title: "",
  description: "",
  submittal_type: "product_data",
  status: "draft",
  revision: "",
  submitted_date: "",
  due_date: "",
  returned_date: "",
  responsible: "",
  notes: "",
};

const EMPTY_CHANGE_ORDER_FORM: FormState = {
  number: "",
  description: "",
  reason: "",
  status: "draft",
  trade: "",
  request_date: "",
  submitted_date: "",
  approved_date: "",
  amount: "",
  labor_cost: "",
  material_cost: "",
  equipment_cost: "",
  subcontract_cost: "",
  markup: "",
  notes: "",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-white/5 text-gray-500 border-white/10",
  open: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  answered: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  closed: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  void: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  submitted: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  under_review: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  approved: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  approved_as_noted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  revise_resubmit: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  rejected: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  pending: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const PRIORITY_STYLES: Record<ControlPriority, string> = {
  low: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  medium: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

function emptyForm(kind: ControlKind): FormState {
  if (kind === "rfi") return EMPTY_RFI_FORM;
  if (kind === "submittal") return EMPTY_SUBMITTAL_FORM;
  return EMPTY_CHANGE_ORDER_FORM;
}

function endpointFor(kind: ControlKind): string {
  return CONTROL_TABS.find((tab) => tab.kind === kind)?.endpoint ?? "/api/rfis";
}

function statusCycle(kind: ControlKind): readonly string[] {
  if (kind === "rfi") return RFI_STATUSES;
  if (kind === "submittal") return SUBMITTAL_STATUSES;
  return CHANGE_ORDER_STATUSES;
}

function prettyStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toMoneyNumber(value: number | string | null): number {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number | string | null): string {
  const amount = toMoneyNumber(value);
  if (!amount) return "-";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function textValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "-";
}

function mapRfiForm(item: RfiItem): FormState {
  return {
    number: item.number ?? "",
    subject: item.subject,
    description: item.description ?? "",
    discipline: item.discipline ?? "",
    status: item.status,
    priority: item.priority,
    submitted_date: item.submitted_date ?? "",
    due_date: item.due_date ?? "",
    assigned_to: item.assigned_to ?? "",
    response: item.response ?? "",
    response_date: item.response_date ?? "",
  };
}

function mapSubmittalForm(item: SubmittalItem): FormState {
  return {
    number: item.number ?? "",
    spec_section: item.spec_section ?? "",
    title: item.title,
    description: item.description ?? "",
    submittal_type: item.submittal_type,
    status: item.status,
    revision: item.revision ?? "",
    submitted_date: item.submitted_date ?? "",
    due_date: item.due_date ?? "",
    returned_date: item.returned_date ?? "",
    responsible: item.responsible ?? "",
    notes: item.notes ?? "",
  };
}

function mapChangeOrderForm(item: ChangeOrderItem): FormState {
  return {
    number: item.number ?? "",
    description: item.description,
    reason: item.reason ?? "",
    status: item.status,
    trade: item.trade ?? "",
    request_date: item.request_date ?? "",
    submitted_date: item.submitted_date ?? "",
    approved_date: item.approved_date ?? "",
    amount: item.amount != null ? String(item.amount) : "",
    labor_cost: item.labor_cost != null ? String(item.labor_cost) : "",
    material_cost: item.material_cost != null ? String(item.material_cost) : "",
    equipment_cost: item.equipment_cost != null ? String(item.equipment_cost) : "",
    subcontract_cost: item.subcontract_cost != null ? String(item.subcontract_cost) : "",
    markup: item.markup != null ? String(item.markup) : "",
    notes: item.notes ?? "",
  };
}

function StatusButton({
  kind,
  status,
  onClick,
}: {
  kind: ControlKind;
  status: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase hover:opacity-80 transition-opacity ${
        STATUS_STYLES[status] ?? STATUS_STYLES.draft
      }`}
      title={`Advance ${kind.replace("_", " ")} status`}
    >
      {prettyStatus(status)}
    </button>
  );
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(4)].map((_, row) => (
        <tr key={row}>
          {[...Array(cols)].map((__, col) => (
            <td key={col} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: col === 1 ? "70%" : "38%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ProjectControlsTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [activeKind, setActiveKind] = useState<ControlKind>("rfi");
  const [rfis, setRfis] = useState<RfiItem[]>([]);
  const [submittals, setSubmittals] = useState<SubmittalItem[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [formKind, setFormKind] = useState<ControlKind>("rfi");
  const [form, setForm] = useState<FormState>(EMPTY_RFI_FORM);
  const [editing, setEditing] = useState<{ kind: ControlKind; id: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadControls = useCallback(async () => {
    const [rfiRes, submittalRes, changeOrderRes] = await Promise.all([
      fetch(`/api/rfis?project_id=${encodeURIComponent(projectId)}`),
      fetch(`/api/submittals?project_id=${encodeURIComponent(projectId)}`),
      fetch(`/api/change-orders?project_id=${encodeURIComponent(projectId)}`),
    ]);

    const [rfiData, submittalData, changeOrderData] = await Promise.all([
      rfiRes.json() as Promise<{ items?: RfiItem[] }>,
      submittalRes.json() as Promise<{ items?: SubmittalItem[] }>,
      changeOrderRes.json() as Promise<{ items?: ChangeOrderItem[] }>,
    ]);

    setRfis(rfiData.items ?? []);
    setSubmittals(submittalData.items ?? []);
    setChangeOrders(changeOrderData.items ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadControls().catch(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [loadControls]);

  const importRfi = useBulkImport<{ project_id: string; subject: string; question: string; status: RfiStatus; priority: ControlPriority }>(projectId, {
    endpoint: "/api/rfis",
    mapRow: (row, pid) => {
      const subject = toStr(pickCtrl(row, ["subject", "title", "topic", "summary"]));
      if (!subject) return null;
      return {
        project_id: pid,
        subject,
        question: toStr(pickCtrl(row, ["question", "description", "detail", "notes"])) ?? subject,
        status: "draft",
        priority: ((toStr(pickCtrl(row, ["priority"])) ?? "medium").toLowerCase() as ControlPriority),
      };
    },
    onComplete: () => { void loadControls(); },
  });

  const importSubmittal = useBulkImport<{ project_id: string; subject: string; type: string; status: SubmittalStatus; priority: ControlPriority }>(projectId, {
    endpoint: "/api/submittals",
    mapRow: (row, pid) => {
      const subject = toStr(pickCtrl(row, ["subject", "title", "spec", "section"]));
      if (!subject) return null;
      const type = (toStr(pickCtrl(row, ["type", "category"])) ?? "shop_drawing").toLowerCase().replace(/\s+/g, "_");
      return {
        project_id: pid,
        subject,
        type,
        status: "draft" as SubmittalStatus,
        priority: ((toStr(pickCtrl(row, ["priority"])) ?? "medium").toLowerCase() as ControlPriority),
      };
    },
    onComplete: () => { void loadControls(); },
  });

  const importChangeOrder = useBulkImport<{ project_id: string; subject: string; reason: string | null; amount: number | null; status: ChangeOrderStatus }>(projectId, {
    endpoint: "/api/change-orders",
    mapRow: (row, pid) => {
      const subject = toStr(pickCtrl(row, ["subject", "title", "description", "summary"]));
      if (!subject) return null;
      return {
        project_id: pid,
        subject,
        reason: toStr(pickCtrl(row, ["reason", "justification", "notes"])),
        amount: toNum(pickCtrl(row, ["amount", "cost", "value", "price"])),
        status: "draft" as ChangeOrderStatus,
      };
    },
    onComplete: () => { void loadControls(); },
  });

  const importControl = (kind: "rfi" | "submittal" | "change_order", parsed: import("@/components/common/UniversalImportButton").ParseResult) => {
    if (kind === "rfi") return importRfi(parsed);
    if (kind === "submittal") return importSubmittal(parsed);
    return importChangeOrder(parsed);
  };

  const summary = useMemo(
    () =>
      getControlSummary({
        rfis,
        submittals,
        changeOrders: changeOrders.map((item) => ({
          status: item.status,
          amount: toMoneyNumber(item.amount),
        })),
      }),
    [rfis, submittals, changeOrders],
  );

  const openAdd = (kind: ControlKind) => {
    setActiveKind(kind);
    setFormKind(kind);
    setForm(emptyForm(kind));
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (kind: ControlKind, item: ControlItem) => {
    setActiveKind(kind);
    setFormKind(kind);
    setEditing({ kind, id: item.id });
    if (kind === "rfi") setForm(mapRfiForm(item as RfiItem));
    else if (kind === "submittal") setForm(mapSubmittalForm(item as SubmittalItem));
    else setForm(mapChangeOrderForm(item as ChangeOrderItem));
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm(formKind));
  };

  const setField = (field: string, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return; // Fix: race guard — prevent duplicate submits
    // Fix: validate required fields before submit (was submitting silently)
    if (formKind === "rfi" && !form.subject?.trim()) { setErrorMsg("Subject is required."); return; }
    if (formKind === "submittal" && !form.title?.trim()) { setErrorMsg("Title is required."); return; }
    if (formKind === "change_order" && !form.description?.trim()) { setErrorMsg("Description is required."); return; }
    setSubmitting(true);
    setErrorMsg(null);
    const endpoint = endpointFor(formKind);
    // Fix: change-order numeric fields were shipped as strings → parseFloat ""/null safely
    const payload: Record<string, unknown> = { ...form, project_id: projectId };
    if (formKind === "change_order") {
      for (const k of ["amount", "labor_cost", "material_cost", "equipment_cost", "subcontract_cost", "markup"]) {
        const v = form[k];
        payload[k] = v && v.trim() !== "" ? parseFloat(v.replace(/[$,]/g, "")) : null;
        if (payload[k] !== null && !Number.isFinite(payload[k] as number)) payload[k] = null;
      }
    }
    try {
      const res = editing
        ? await fetch(`${endpoint}/${encodeURIComponent(editing.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        // Fix: was swallowing API errors silently
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Save failed (${res.status})`);
        return;
      }
      cancelForm();
      await loadControls();
    } catch {
      setErrorMsg("Network error — could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateLocalStatus = (kind: ControlKind, id: string, status: string) => {
    if (kind === "rfi") {
      setRfis((items) => items.map((item) => (item.id === id ? { ...item, status: status as RfiStatus } : item)));
    } else if (kind === "submittal") {
      setSubmittals((items) =>
        items.map((item) => (item.id === id ? { ...item, status: status as SubmittalStatus } : item)),
      );
    } else {
      setChangeOrders((items) =>
        items.map((item) => (item.id === id ? { ...item, status: status as ChangeOrderStatus } : item)),
      );
    }
  };

  const cycleStatus = async (kind: ControlKind, item: ControlItem & { status: string }) => {
    const cycle = statusCycle(kind);
    const current = cycle.indexOf(item.status);
    const next = cycle[(current + 1) % cycle.length];
    updateLocalStatus(kind, item.id, next);
    try {
      const res = await fetch(`${endpointFor(kind)}/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        // Fix: was swallowing — surface and reload to rollback
        setErrorMsg(`Status update failed (${res.status})`);
        await loadControls();
      }
    } catch {
      setErrorMsg("Network error — could not update status.");
      await loadControls();
    }
  };

  const deleteItem = async (kind: ControlKind, id: string) => {
    if (!(await confirm({ title: String("Delete this project control item?"), destructive: true }))) return;
    if (kind === "rfi") setRfis((items) => items.filter((item) => item.id !== id));
    else if (kind === "submittal") setSubmittals((items) => items.filter((item) => item.id !== id));
    else setChangeOrders((items) => items.filter((item) => item.id !== id));

    try {
      const res = await fetch(`${endpointFor(kind)}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        // Fix: optimistic delete with no rollback on API failure
        setErrorMsg(`Delete failed (${res.status}) — refreshing list.`);
        await loadControls();
      }
    } catch {
      setErrorMsg("Network error — could not delete.");
      await loadControls();
    }
  };

  const activeItems =
    activeKind === "rfi" ? rfis : activeKind === "submittal" ? submittals : changeOrders;

  const inputCls =
    "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Open RFIs" value={summary.rfis_open} icon={<FileQuestion size={13} />} color="text-[#00D2FF]" />
        <SummaryCard label="Open Submittals" value={summary.submittals_open} icon={<ClipboardCheck size={13} />} color="text-purple-400" />
        <SummaryCard label="Pending COs" value={summary.change_orders_pending} icon={<CircleDollarSign size={13} />} color="text-orange-400" />
        <SummaryCard
          label="Pending CO Value"
          value={`$${summary.pending_change_order_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          icon={<CircleDollarSign size={13} />}
          color="text-[#CCFF00]"
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0E0F12] overflow-hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 overflow-x-auto">
            {CONTROL_TABS.map((tab) => (
              <button
                key={tab.kind}
                type="button"
                onClick={() => setActiveKind(tab.kind)}
                className={`px-3 py-2 rounded-lg border text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap ${
                  activeKind === tab.kind
                    ? "border-[#CCFF00]/30 bg-[#CCFF00]/10 text-[#CCFF00]"
                    : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton
              hint={activeKind === "rfi" ? "rfis" : activeKind === "submittal" ? "submittals" : "change_orders"}
              onParsed={(parsed) => importControl(activeKind, parsed)}
              accept=".xlsx,.xls,.csv,.docx,.pdf"
            />
            <button
              type="button"
              onClick={() => openAdd(activeKind)}
              className="flex items-center justify-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Plus size={11} />
              Add {CONTROL_TABS.find((tab) => tab.kind === activeKind)?.label}
            </button>
          </div>
        </div>

        {activeKind === "rfi" && (
          <RfiTable
            items={rfis}
            loading={loading}
            onEdit={(item) => openEdit("rfi", item)}
            onDelete={(id) => deleteItem("rfi", id)}
            onCycle={(item) => cycleStatus("rfi", item)}
          />
        )}
        {activeKind === "submittal" && (
          <SubmittalTable
            items={submittals}
            loading={loading}
            onEdit={(item) => openEdit("submittal", item)}
            onDelete={(id) => deleteItem("submittal", id)}
            onCycle={(item) => cycleStatus("submittal", item)}
          />
        )}
        {activeKind === "change_order" && (
          <ChangeOrderTable
            items={changeOrders}
            loading={loading}
            onEdit={(item) => openEdit("change_order", item)}
            onDelete={(id) => deleteItem("change_order", id)}
            onCycle={(item) => cycleStatus("change_order", item)}
          />
        )}

        {!loading && activeItems.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={<Activity className="w-6 h-6" />}
              title="No controls data yet"
              description="Track budget, schedule, and risk health here."
              actionLabel="Add Entry"
              onAction={() => openAdd(activeKind)}
            />
          </div>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editing ? "Edit" : "New"} {CONTROL_TABS.find((tab) => tab.kind === formKind)?.label}
          </p>
          <form onSubmit={saveForm} className="space-y-4">
            {formKind === "rfi" && <RfiForm form={form} inputCls={inputCls} setField={setField} />}
            {formKind === "submittal" && <SubmittalForm form={form} inputCls={inputCls} setField={setField} />}
            {formKind === "change_order" && <ChangeOrderForm form={form} inputCls={inputCls} setField={setField} />}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving..." : editing ? "Save Changes" : "Add Item"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
      <div className={color}>{icon}</div>
      <p className={`text-2xl font-black leading-none mt-2 ${color}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-widest text-gray-600 mt-1">{label}</p>
    </div>
  );
}

function RfiTable({
  items,
  loading,
  onEdit,
  onDelete,
  onCycle,
}: {
  items: RfiItem[];
  loading: boolean;
  onEdit: (item: RfiItem) => void;
  onDelete: (id: string) => void;
  onCycle: (item: RfiItem) => void;
}) {
  if (loading) return <TableSkeleton cols={9} />;
  if (items.length === 0) return null;
  return (
    <Table headers={["Number", "Subject", "Discipline", "Priority", "Status", "Due", "Assigned", "Response", ""]}>
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
          <Td mono>{textValue(item.number)}</Td>
          <Td strong>{item.subject}</Td>
          <Td>{textValue(item.discipline)}</Td>
          <td className="px-4 py-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${PRIORITY_STYLES[item.priority]}`}>
              {item.priority}
            </span>
          </td>
          <td className="px-4 py-3">
            <StatusButton kind="rfi" status={item.status} onClick={() => onCycle(item)} />
          </td>
          <Td>{fmtDate(item.due_date)}</Td>
          <Td>{textValue(item.assigned_to)}</Td>
          <Td>{textValue(item.response)}</Td>
          <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} />
        </tr>
      ))}
    </Table>
  );
}

function SubmittalTable({
  items,
  loading,
  onEdit,
  onDelete,
  onCycle,
}: {
  items: SubmittalItem[];
  loading: boolean;
  onEdit: (item: SubmittalItem) => void;
  onDelete: (id: string) => void;
  onCycle: (item: SubmittalItem) => void;
}) {
  if (loading) return <TableSkeleton cols={9} />;
  if (items.length === 0) return null;
  return (
    <Table headers={["Number", "Title", "Spec", "Type", "Revision", "Status", "Due", "Responsible", ""]}>
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
          <Td mono>{textValue(item.number)}</Td>
          <Td strong>{item.title}</Td>
          <Td mono>{textValue(item.spec_section)}</Td>
          <Td>{prettyStatus(item.submittal_type)}</Td>
          <Td>{textValue(item.revision)}</Td>
          <td className="px-4 py-3">
            <StatusButton kind="submittal" status={item.status} onClick={() => onCycle(item)} />
          </td>
          <Td>{fmtDate(item.due_date)}</Td>
          <Td>{textValue(item.responsible)}</Td>
          <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} />
        </tr>
      ))}
    </Table>
  );
}

function ChangeOrderTable({
  items,
  loading,
  onEdit,
  onDelete,
  onCycle,
}: {
  items: ChangeOrderItem[];
  loading: boolean;
  onEdit: (item: ChangeOrderItem) => void;
  onDelete: (id: string) => void;
  onCycle: (item: ChangeOrderItem) => void;
}) {
  if (loading) return <TableSkeleton cols={8} />;
  if (items.length === 0) return null;
  return (
    <Table headers={["Number", "Description", "Trade", "Status", "Amount", "Submitted", "Approved", ""]}>
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
          <Td mono>{textValue(item.number)}</Td>
          <Td strong>{item.description}</Td>
          <Td>{textValue(item.trade)}</Td>
          <td className="px-4 py-3">
            <StatusButton kind="change_order" status={item.status} onClick={() => onCycle(item)} />
          </td>
          <Td mono strong>{money(item.amount)}</Td>
          <Td>{fmtDate(item.submitted_date)}</Td>
          <Td>{fmtDate(item.approved_date)}</Td>
          <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} />
        </tr>
      ))}
    </Table>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px]">
        <thead>
          <tr className="bg-[#0A0A0B] border-b border-white/10">
            {headers.map((header) => (
              <th key={header} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
    </div>
  );
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px]">
        <tbody>
          <SkeletonRows cols={cols} />
        </tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  mono,
  strong,
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td className={`px-4 py-3 text-xs max-w-[240px] truncate ${mono ? "font-mono" : ""} ${strong ? "text-white font-semibold" : "text-gray-400"}`}>
      {children}
    </td>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <td className="px-4 py-3">
      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" aria-label="Edit" onClick={onEdit} className="min-h-[40px] text-gray-600 hover:text-white transition-colors" title="Edit">
          <Pencil size={14} />
        </button>
        <button type="button" aria-label="Delete" onClick={onDelete} className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
    </td>
  );
}

function RfiForm({ form, inputCls, setField }: FormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Number"><input value={form.number} onChange={(e) => setField("number", e.target.value)} className={`${inputCls} font-mono`} placeholder="RFI-001" /></Field>
      <Field label="Status"><Select value={form.status} options={RFI_STATUSES} inputCls={inputCls} onChange={(value) => setField("status", value)} /></Field>
      <Field label="Priority"><Select value={form.priority} options={CONTROL_PRIORITIES} inputCls={inputCls} onChange={(value) => setField("priority", value)} /></Field>
      <Field label="Subject *" wide><input required value={form.subject} onChange={(e) => setField("subject", e.target.value)} className={inputCls} placeholder="Clarify detail or field condition" /></Field>
      <Field label="Discipline"><input value={form.discipline} onChange={(e) => setField("discipline", e.target.value)} className={inputCls} placeholder="Civil, structural, plumbing" /></Field>
      <Field label="Assigned To"><input value={form.assigned_to} onChange={(e) => setField("assigned_to", e.target.value)} className={inputCls} placeholder="Architect, engineer, owner" /></Field>
      <Field label="Submitted Date"><input type="date" value={form.submitted_date} onChange={(e) => setField("submitted_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Due Date"><input type="date" value={form.due_date} onChange={(e) => setField("due_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Response Date"><input type="date" value={form.response_date} onChange={(e) => setField("response_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Description" wide><input value={form.description} onChange={(e) => setField("description", e.target.value)} className={inputCls} placeholder="Question, drawing reference, or field condition" /></Field>
      <Field label="Response" wide><input value={form.response} onChange={(e) => setField("response", e.target.value)} className={inputCls} placeholder="Official response or direction" /></Field>
    </div>
  );
}

function SubmittalForm({ form, inputCls, setField }: FormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Number"><input value={form.number} onChange={(e) => setField("number", e.target.value)} className={`${inputCls} font-mono`} placeholder="SUB-001" /></Field>
      <Field label="Spec Section"><input value={form.spec_section} onChange={(e) => setField("spec_section", e.target.value)} className={`${inputCls} font-mono`} placeholder="22 11 16" /></Field>
      <Field label="Revision"><input value={form.revision} onChange={(e) => setField("revision", e.target.value)} className={inputCls} placeholder="Rev 1" /></Field>
      <Field label="Title *" wide><input required value={form.title} onChange={(e) => setField("title", e.target.value)} className={inputCls} placeholder="Product data, shop drawing, or sample" /></Field>
      <Field label="Type"><Select value={form.submittal_type} options={SUBMITTAL_TYPES} inputCls={inputCls} onChange={(value) => setField("submittal_type", value)} /></Field>
      <Field label="Status"><Select value={form.status} options={SUBMITTAL_STATUSES} inputCls={inputCls} onChange={(value) => setField("status", value)} /></Field>
      <Field label="Responsible"><input value={form.responsible} onChange={(e) => setField("responsible", e.target.value)} className={inputCls} placeholder="Subcontractor or reviewer" /></Field>
      <Field label="Submitted Date"><input type="date" value={form.submitted_date} onChange={(e) => setField("submitted_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Due Date"><input type="date" value={form.due_date} onChange={(e) => setField("due_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Returned Date"><input type="date" value={form.returned_date} onChange={(e) => setField("returned_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Description" wide><input value={form.description} onChange={(e) => setField("description", e.target.value)} className={inputCls} placeholder="Scope or drawing reference" /></Field>
      <Field label="Notes" wide><input value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={inputCls} placeholder="Reviewer comments or next action" /></Field>
    </div>
  );
}

function ChangeOrderForm({ form, inputCls, setField }: FormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Number"><input value={form.number} onChange={(e) => setField("number", e.target.value)} className={`${inputCls} font-mono`} placeholder="CO-001" /></Field>
      <Field label="Status"><Select value={form.status} options={CHANGE_ORDER_STATUSES} inputCls={inputCls} onChange={(value) => setField("status", value)} /></Field>
      <Field label="Trade"><input value={form.trade} onChange={(e) => setField("trade", e.target.value)} className={inputCls} placeholder="Civil, electrical, GC" /></Field>
      <Field label="Description *" wide><input required value={form.description} onChange={(e) => setField("description", e.target.value)} className={inputCls} placeholder="Changed work or owner direction" /></Field>
      <Field label="Reason"><input value={form.reason} onChange={(e) => setField("reason", e.target.value)} className={inputCls} placeholder="ASI, RFI, field condition" /></Field>
      <Field label="Amount"><input type="number" step="any" value={form.amount} onChange={(e) => setField("amount", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Labor"><input type="number" step="any" value={form.labor_cost} onChange={(e) => setField("labor_cost", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Material"><input type="number" step="any" value={form.material_cost} onChange={(e) => setField("material_cost", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Equipment"><input type="number" step="any" value={form.equipment_cost} onChange={(e) => setField("equipment_cost", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Subcontract"><input type="number" step="any" value={form.subcontract_cost} onChange={(e) => setField("subcontract_cost", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Markup"><input type="number" step="any" value={form.markup} onChange={(e) => setField("markup", e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" /></Field>
      <Field label="Request Date"><input type="date" value={form.request_date} onChange={(e) => setField("request_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Submitted Date"><input type="date" value={form.submitted_date} onChange={(e) => setField("submitted_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Approved Date"><input type="date" value={form.approved_date} onChange={(e) => setField("approved_date", e.target.value)} className={inputCls} /></Field>
      <Field label="Notes" wide><input value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={inputCls} placeholder="Pricing backup, owner notes, or next action" /></Field>
    </div>
  );
}

interface FormProps {
  form: FormState;
  inputCls: string;
  setField: (field: string, value: string) => void;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  options,
  inputCls,
  onChange,
}: {
  value: string;
  options: readonly string[];
  inputCls: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputCls}>
      {options.map((option) => (
        <option key={option} value={option}>
          {prettyStatus(option)}
        </option>
      ))}
    </select>
  );
}
