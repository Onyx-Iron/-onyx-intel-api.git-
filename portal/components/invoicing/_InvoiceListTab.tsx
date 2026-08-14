"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import { FileText, Receipt, Plus } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr, toNum, toDate } from "@/components/common/useBulkImport";
import {
  Invoice, InvoiceDirection, InvoiceStatus,
  INVOICE_STATUS_STYLES, INPUT_CLS,
  fmtDate, fmtCurrency, pickField, agingBucket,
} from "./_shared";

import { useConfirm } from "@/components/common/ConfirmDialog";

interface FormState {
  invoice_number: string;
  vendor_or_customer: string;
  description: string;
  amount: string;
  retainage: string;
  invoice_date: string;
  due_date: string;
  paid_date: string;
  status: InvoiceStatus;
  payment_method: string;
  reference: string;
  notes: string;
}
const EMPTY_FORM: FormState = {
  invoice_number: "", vendor_or_customer: "", description: "",
  amount: "", retainage: "", invoice_date: "", due_date: "", paid_date: "",
  status: "open", payment_method: "", reference: "", notes: "",
};

interface InvoicePayload {
  project_id: string;
  direction: InvoiceDirection;
  invoice_number: string | null;
  vendor_or_customer: string;
  description: string | null;
  amount: number;
  retainage: number | null;
  invoice_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  status: InvoiceStatus;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
}
interface InvoiceListTabProps {
  projectId: string;
  /** Filter the API/list. Undefined = both directions (open/closed views). */
  direction?: InvoiceDirection;
  /** Server-side status filter. `open` => open+overdue, `closed` => paid+canceled. */
  statusFilter?: "open" | "closed" | "all";
  /** Heading shown in the card header. */
  title: string;
  /** Default direction selected in the manual form (used for open/closed combined views). */
  defaultFormDirection?: InvoiceDirection;
  /** Show aging buckets (Open Invoices view). */
  showAging?: boolean;
  /** Counterparty column label. */
  counterpartyLabel?: string;
  /** Empty-state title. */
  emptyTitle?: string;
}
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "55%" : "35%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function InvoiceListTab({
  projectId, direction, statusFilter, title,
  defaultFormDirection = "receivable",
  showAging = false,
  counterpartyLabel = "Counterparty",
  emptyTitle = "No invoices yet",
}: InvoiceListTabProps) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formDirection, setFormDirection] = useState<InvoiceDirection>(direction ?? defaultFormDirection);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ project_id: projectId });
    if (direction) params.set("direction", direction);
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/invoices?${params.toString()}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: Invoice[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Could not load invoices. Refresh the page and try again."); setLoading(false); });
  }, [direction, projectId, statusFilter]);

  useProjectSyncRefresh(load);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const importItems = useBulkImport<InvoicePayload>(projectId, {
    endpoint: "/api/invoices",
    mapRow: (row, pid) => {
      const vc = toStr(pickField(row, ["customer", "vendor", "client", "payee", "payer", "company", "vendororcustomer"]));
      if (!vc) return null;
      const amt = toNum(pickField(row, ["amount", "total", "balance", "amountdue"])) ?? 0;
      return {
        project_id: pid,
        direction: direction ?? defaultFormDirection,
        invoice_number: toStr(pickField(row, ["invoicenumber", "invoiceno", "invoice", "number", "inv"])),
        vendor_or_customer: vc,
        description: toStr(pickField(row, ["description", "memo", "details"])),
        amount: amt,
        retainage: toNum(pickField(row, ["retainage", "retention", "holdback"])),
        invoice_date: toDate(pickField(row, ["invoicedate", "date", "issued"])),
        due_date: toDate(pickField(row, ["duedate", "due"])),
        paid_date: toDate(pickField(row, ["paiddate", "paid"])),
        status: "open" as InvoiceStatus,
        payment_method: toStr(pickField(row, ["paymentmethod", "method"])),
        reference: toStr(pickField(row, ["reference", "ref", "po"])),
        notes: toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormDirection(direction ?? defaultFormDirection);
    setShowForm(true);
  };

  const openEdit = (it: Invoice) => {
    setEditId(it.id);
    setFormDirection(it.direction);
    setForm({
      invoice_number:     it.invoice_number ?? "",
      vendor_or_customer: it.vendor_or_customer,
      description:        it.description ?? "",
      amount:             String(it.amount ?? ""),
      retainage:          it.retainage == null ? "" : String(it.retainage),
      invoice_date:       it.invoice_date ?? "",
      due_date:           it.due_date ?? "",
      paid_date:          it.paid_date ?? "",
      status:             it.status,
      payment_method:     it.payment_method ?? "",
      reference:          it.reference ?? "",
      notes:              it.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.vendor_or_customer.trim()) {
      setErrorMsg("Vendor or customer is required.");
      return;
    }
    setSubmitting(true);
    const payload = {
      project_id: projectId,
      direction: formDirection,
      invoice_number: form.invoice_number || null,
      vendor_or_customer: form.vendor_or_customer.trim(),
      description: form.description || null,
      amount: form.amount === "" ? 0 : Number(form.amount),
      retainage: form.retainage === "" ? null : Number(form.retainage),
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
      paid_date: form.paid_date || null,
      status: form.status,
      payment_method: form.payment_method || null,
      reference: form.reference || null,
      notes: form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/invoices/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Could not save this invoice (${res.status}). Check the form and try again.`);
        return;
      }
      cancelForm();
      load();
    } catch {
      setErrorMsg("Could not reach the server just now. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!(await confirm({ title: String("Delete this invoice?"), destructive: true }))) return;
    const prev = items;
    setItems((curr) => curr.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) { setItems(prev); setErrorMsg(`Could not delete that invoice (${res.status}). Refresh the list and try again.`); }
    } catch {
      setItems(prev);
      setErrorMsg("Could not delete that invoice just now. Refresh the list and try again in a moment.");
    }
  };

  // Aging buckets for Open Invoices view.
  const aging = showAging ? items.reduce<Record<string, { count: number; total: number }>>((acc, it) => {
    const b = agingBucket(it.invoice_date);
    if (!acc[b]) acc[b] = { count: 0, total: 0 };
    acc[b].count += 1;
    acc[b].total += Number(it.amount ?? 0);
    return acc;
  }, {}) : null;

  const totalAmount = items.reduce((s, i) => s + Number(i.amount ?? 0), 0);

  const headers = [
    "Invoice #", counterpartyLabel, "Amount",
    showAging ? "Aging" : "Invoice Date",
    "Due Date", "Status", "Reference", "",
  ];

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      {/* Summary strip */}
      {showAging && aging ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Total Open</p>
            <p className="text-2xl font-black leading-none text-white">{fmtCurrency(totalAmount)}</p>
          </div>
          {(["0-30", "31-60", "61-90", "90+"] as const).map((b) => {
            const data = aging[b] ?? { count: 0, total: 0 };
            const color = b === "0-30" ? "text-[#CCFF00]" : b === "31-60" ? "text-[#00D2FF]" : b === "61-90" ? "text-orange-400" : "text-[#E50914]";
            return (
              <div key={b} className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
                <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">{b} days</p>
                <p className={`text-xl font-black leading-none ${color}`}>{fmtCurrency(data.total)}</p>
                <p className="text-[10px] text-gray-500 mt-1">{data.count} invoice{data.count === 1 ? "" : "s"}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Invoices</p>
            <p className="text-2xl font-black leading-none text-white">{items.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Total</p>
            <p className="text-2xl font-black leading-none text-[#CCFF00]">{fmtCurrency(totalAmount)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Open</p>
            <p className="text-2xl font-black leading-none text-[#00D2FF]">
              {items.filter((i) => i.status === "open" || i.status === "overdue").length}
            </p>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FileText size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton hint="invoice" onParsed={importItems} caption="Excel, CSV, PDF" />
            <button onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
              <Plus size={11} /> Add Invoice
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {headers.map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows cols={headers.length} />
              ) : items.length === 0 && !error ? (
                <tr><td colSpan={headers.length}>
                  <div className="py-4">
                    <EmptyState
                      icon={<Receipt className="w-6 h-6" />}
                      title={emptyTitle}
                      description="Track invoices, payments, and lien waivers, then keep the project billing picture in one place."
                      actionLabel="Add Invoice"
                      onAction={openAdd}
                      secondaryLabel="View projects"
                      secondaryHref="/dashboard/projects"
                    />
                  </div>
                </td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-white text-xs font-mono">{it.invoice_number ?? "-"}</td>
                    <td className="px-4 py-3 text-white text-xs">{it.vendor_or_customer}</td>
                    <td className="px-4 py-3 text-white text-xs font-mono">{fmtCurrency(it.amount)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {showAging ? agingBucket(it.invoice_date) : fmtDate(it.invoice_date)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(it.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${INVOICE_STATUS_STYLES[it.status]}`}>
                        {it.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{it.reference ?? "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" aria-label="Edit invoice" onClick={() => openEdit(it)} className="min-h-[40px] text-gray-600 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button type="button" aria-label="Delete invoice" onClick={() => deleteItem(it.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914]">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">{editId ? "Edit Invoice" : "New Invoice"}</p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {!direction && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Direction</label>
                  <select value={formDirection} onChange={(e) => setFormDirection(e.target.value as InvoiceDirection)} className={INPUT_CLS}>
                    <option value="receivable">Receivable (to customer)</option>
                    <option value="payable">Payable (from vendor)</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Invoice #</label>
                <input type="text" value={form.invoice_number} onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))} className={`${INPUT_CLS} font-mono`} placeholder="INV-2026-0001" />
              </div>
              <div className={direction ? "md:col-span-2" : ""}>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">{counterpartyLabel} *</label>
                <input type="text" required value={form.vendor_or_customer} onChange={(e) => setForm((f) => ({ ...f, vendor_or_customer: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Amount</label>
                <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={`${INPUT_CLS} font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Retainage</label>
                <input type="number" step="0.01" value={form.retainage} onChange={(e) => setForm((f) => ({ ...f, retainage: e.target.value }))} className={`${INPUT_CLS} font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as InvoiceStatus }))} className={INPUT_CLS}>
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="disputed">Disputed</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Invoice Date</label>
                <input type="date" value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Due Date</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Paid Date</label>
                <input type="date" value={form.paid_date} onChange={(e) => setForm((f) => ({ ...f, paid_date: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Payment Method</label>
                <input type="text" value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))} className={INPUT_CLS} placeholder="ACH, Check, Card" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Reference / PO</label>
                <input type="text" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={`${INPUT_CLS} font-mono`} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT_CLS} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Invoice"}
              </button>
              <button type="button" onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
