"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface EstimateRow {
  id?: string;
  cost_code: string;
  description: string;
  quantity: number;
  unit: string;
}

interface VendorBid {
  id: string;
  vendor_name: string;
  contact_email: string;
  unit_price: number;
  lead_time_days: number | null;
  status: "pending" | "awarded" | "declined";
  submitted_at: string;
}

interface RequestItem {
  id: string;
  item_description: string;
  quantity: number;
  unit: string | null;
  status: "open" | "awarded" | "cancelled";
  bids: VendorBid[];
}

interface Batch {
  batch_id: string;
  batch_label: string | null;
  required_date: string | null;
  items: RequestItem[];
}

interface PurchaseOrder {
  id: string;
  po_number: number;
  total_amount: number;
  status: string;
  vendor_bid_id: string;
  email_sent_at: string | null;
}

export default function ProcurementBoard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/requests?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { batches: Batch[]; purchase_orders: PurchaseOrder[] };
        setBatches(data.batches ?? []);
        setPurchaseOrders(data.purchase_orders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function approve(bidId: string) {
    setApprovingId(bidId);
    try {
      const res = await fetch(`/api/procurement/bids/${encodeURIComponent(bidId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Approve failed: ${data.error ?? res.status}`);
        return;
      }
      const emailNote = data.email_status === "sent" ? "Vendor notified by email."
        : data.email_status === "failed" ? "PO issued, but the vendor email failed to send."
        : "PO issued. Connect Google to auto-email vendors.";
      alert(`PO #${data.purchase_order.po_number} issued — $${Number(data.purchase_order.total_amount).toFixed(2)}. ${emailNote}`);
      await load();
    } finally {
      setApprovingId(null);
    }
  }

  function copyVendorLink(requestId: string) {
    const url = `${window.location.origin}/public/bids/${requestId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(requestId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href={`/dashboard/projects/${projectId}`} className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white">← Back</Link>
          <h2 className="mt-1 text-xs font-bold text-white uppercase tracking-widest">Procurement Marketplace</h2>
          <p className="text-[11px] text-gray-500">{projectName}</p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
        >
          Package Estimate Items as RFQ
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-white/40">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-10 text-center text-sm text-white/50">
          No RFQs yet. Click <b>Package Estimate Items as RFQ</b> to bundle line items and send vendor links.
        </div>
      ) : (
        <div className="space-y-6">
          {batches.map((batch) => (
            <div key={batch.batch_id} className="rounded-xl border border-white/10 bg-[#0E0F12] overflow-hidden">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-semibold text-white">{batch.batch_label || "Untitled RFQ"}</div>
                {batch.required_date && <div className="text-[10px] text-white/40">Needed by {batch.required_date}</div>}
              </div>
              <div className="divide-y divide-white/5">
                {batch.items.map((item) => {
                  const lowest = item.bids.length > 0 ? Math.min(...item.bids.map((b) => b.unit_price)) : null;
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-white">{item.item_description}</div>
                          <div className="text-[10px] text-white/40">{item.quantity.toLocaleString()} {item.unit ?? ""} · {item.status.toUpperCase()}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyVendorLink(item.id)}
                          className="text-[10px] uppercase tracking-widest font-mono text-[#00D2FF] hover:opacity-70"
                        >
                          {copiedId === item.id ? "Link Copied!" : "Copy Vendor Link"}
                        </button>
                      </div>

                      {item.bids.length > 0 && (
                        <table className="mt-2 w-full text-xs">
                          <thead>
                            <tr className="text-left text-[9px] uppercase tracking-widest text-white/40">
                              <th className="py-1 pr-2">Vendor</th>
                              <th className="py-1 pr-2 text-right">Unit Price</th>
                              <th className="py-1 pr-2 text-right">Lead Time</th>
                              <th className="py-1 pr-2">Status</th>
                              <th className="py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.bids.map((b) => (
                              <tr key={b.id} className={b.unit_price === lowest ? "bg-[#CCFF00]/[0.06]" : ""}>
                                <td className="py-1 pr-2 text-white/80">{b.vendor_name}</td>
                                <td className={`py-1 pr-2 text-right font-mono ${b.unit_price === lowest ? "text-[#CCFF00] font-bold" : "text-white/70"}`}>
                                  ${b.unit_price.toFixed(2)}{b.unit_price === lowest ? " ★" : ""}
                                </td>
                                <td className="py-1 pr-2 text-right text-white/60">{b.lead_time_days != null ? `${b.lead_time_days}d` : "—"}</td>
                                <td className="py-1 pr-2 text-white/50 uppercase text-[10px]">{b.status}</td>
                                <td className="py-1 text-right">
                                  {b.status === "pending" && item.status === "open" && (
                                    <button
                                      type="button"
                                      onClick={() => approve(b.id)}
                                      disabled={approvingId === b.id}
                                      className="rounded-full bg-[#CCFF00]/10 border border-[#CCFF00]/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40"
                                    >
                                      {approvingId === b.id ? "Issuing…" : "Approve & Generate PO"}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {purchaseOrders.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">Purchase Orders</div>
          <div className="rounded-xl border border-white/10 bg-[#0E0F12] divide-y divide-white/5">
            {purchaseOrders.map((po) => (
              <div key={po.id} className="flex items-center justify-between px-4 py-2 text-xs">
                <span className="font-mono text-white/80">PO #{po.po_number}</span>
                <span className="font-mono text-[#CCFF00]">${Number(po.total_amount).toFixed(2)}</span>
                <span className="text-white/40 uppercase text-[10px]">{po.status}</span>
                <span className="text-white/30 text-[10px]">{po.email_sent_at ? "Emailed" : "Not emailed"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {wizardOpen && (
        <QuotePackagingWizard
          projectId={projectId}
          onClose={() => setWizardOpen(false)}
          onDone={async () => { setWizardOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Quote Packaging wizard ─────────────────────────────────────────────────
function QuotePackagingWizard({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [batchLabel, setBatchLabel] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/estimate/matrix?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { rows?: EstimateRow[] }) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggle = (i: number) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const selectedCount = checked.size;

  async function submit() {
    const items = Array.from(checked).map((i) => {
      const r = rows[i];
      return { description: r.description || r.cost_code, quantity: r.quantity, unit: r.unit, source_estimate_id: r.id ?? null };
    });
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, batch_label: batchLabel || null, required_date: requiredDate || null, items }),
      });
      if (res.ok) {
        onDone();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Package failed: ${err.error ?? res.status}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0E0F12] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Package Estimate Items as RFQ</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">RFQ Label</span>
            <input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} placeholder="e.g. Concrete package" className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Needed By</span>
            <input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-white/40">Loading estimate rows…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-white/40">No estimate rows found for this project yet.</div>
        ) : (
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0A0A0B]">
                <tr className="text-left text-[9px] uppercase tracking-widest text-white/40">
                  <th className="px-2 py-1.5 w-8"></th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                  <th className="px-2 py-1.5">Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? i} className="border-t border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={() => toggle(i)}>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="px-2 py-1.5 text-white/80">{r.description || r.cost_code}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-white/70">{r.quantity}</td>
                    <td className="px-2 py-1.5 text-white/50">{r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[11px] text-white/40">{selectedCount} item{selectedCount === 1 ? "" : "s"} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={selectedCount === 0 || submitting}
              className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
            >
              {submitting ? "Packaging…" : "Create RFQ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
