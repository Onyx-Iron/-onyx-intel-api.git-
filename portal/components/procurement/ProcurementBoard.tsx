"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import Link from "next/link";
import { useToast } from "@/components/common/Toast";

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

function parseRFQBrief(
  input: string,
  projectName: string,
): { batchLabel: string; requiredDate: string | null; items: Array<{ description: string; quantity: number; unit: string; source_estimate_id: string | null }> } {
  const text = input.trim();
  const normalized = text.toLowerCase();
  const dueMatch = text.match(/\b(?:due|needed by|required by|bid due)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i);
  const batchLabelMatch =
    text.match(/(?:rfq|quote package|procurement request|package)\s+for\s+["'“”]?([^,"'\n]+)["'“”]?/i) ??
    text.match(/(?:called|named)\s+["'“”]?([^,"'\n]+)["'“”]?/i);

  const quantityMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(ea|each|lf|lft|sf|sy|cy|ton|tons|lbs|lb|yd|hr|hrs|hours|days?)\b/gi)];
  const itemMatches = [...text.matchAll(/\b(?:for|need|needs|include|package)\s+([^.;\n]+?)(?=(?:\s+\d+(?:\.\d+)?\s*(?:ea|each|lf|lft|sf|sy|cy|ton|tons|lbs|lb|yd|hr|hrs|hours|days?)\b)|[.;\n]|$)/gi)];

  const items = itemMatches.slice(0, 8).map((match, index) => ({
    description: match[1].trim().slice(0, 160),
    quantity: Number(quantityMatches[index]?.[1] ?? 1) || 1,
    unit: String(quantityMatches[index]?.[2] ?? "ea").toUpperCase(),
    source_estimate_id: null,
  }));

  if (items.length === 0) {
    const fallbackDescription = text.replace(/^(create|new|build|package)\s+(?:an?\s+)?(?:rfq|quote package|procurement request)\s*/i, "").trim();
    items.push({
      description: fallbackDescription || "Review procurement needs",
      quantity: 1,
      unit: normalized.includes("linear") ? "LF" : "EA",
      source_estimate_id: null,
    });
  }

  const batchLabel = batchLabelMatch?.[1]?.trim() ?? `${projectName} quote request`;
  return { batchLabel, requiredDate: dueMatch?.[1] ?? null, items };
}

export default function ProcurementBoard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [codexBrief, setCodexBrief] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [autopackRunning, setAutopackRunning] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/procurement/requests?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { batches?: Batch[]; purchase_orders?: PurchaseOrder[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not load procurement requests (${res.status}). Refresh and try again.`);
      setBatches(data.batches ?? []);
      setPurchaseOrders(data.purchase_orders ?? []);
    } catch (err) {
      setBatches([]);
      setPurchaseOrders([]);
      setLoadError(err instanceof Error ? err.message : "Could not load procurement requests. Refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useProjectSyncRefresh(load);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function approve(bidId: string) {
    setApprovingId(bidId);
    try {
      const res = await fetch(`/api/procurement/bids/${encodeURIComponent(bidId)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: String(`Approve failed: ${data.error ?? res.status}`), kind: "error" });
        return;
      }
      const emailNote =
        data.email_status === "sent" ? "Vendor notified by email."
          : data.email_status === "failed" ? "PO issued, but the vendor email failed to send."
          : "PO issued. Connect Google to auto-email vendors.";
      toast({ title: `PO #${data.purchase_order.po_number} issued - $${Number(data.purchase_order.total_amount).toFixed(2)}.`, description: emailNote, kind: "success" });
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

  async function autopackEstimate() {
    if (autopackRunning) return;
    setAutopackRunning(true);
    try {
      const estimateRes = await fetch(`/api/estimate/current?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const estimateData = (await estimateRes.json().catch(() => ({}))) as { rows?: EstimateRow[]; error?: string };
      if (!estimateRes.ok) throw new Error(estimateData.error ?? `HTTP ${estimateRes.status}`);

      const rows = (estimateData.rows ?? []).slice(0, 8);
      if (rows.length === 0) {
        toast({ title: "No estimate rows found to package.", kind: "info" });
        return;
      }

      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          batch_label: `${projectName} quote request`,
          required_date: null,
          items: rows.map((r) => ({
            description: r.description || r.cost_code,
            quantity: r.quantity,
            unit: r.unit,
            source_estimate_id: r.id ?? null,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
      toast({ title: `Quote request created from ${rows.length} estimate item${rows.length === 1 ? "" : "s"}.`, kind: "success" });
    } catch (err) {
      toast({ title: String(`Auto-package failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      setAutopackRunning(false);
    }
  }

  async function createFromBrief() {
    const brief = codexBrief.trim();
    if (!brief || codexBusy) return;
    setCodexBusy(true);
    try {
      const parsed = parseRFQBrief(brief, projectName);
      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          batch_label: parsed.batchLabel,
          required_date: parsed.requiredDate,
          items: parsed.items,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCodexBrief("");
      await load();
      toast({ title: `Created quote request from notes with ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}.`, kind: "success" });
    } catch (error) {
      toast({ title: String(`Brief import failed: ${error instanceof Error ? error.message : String(error)}`), kind: "error" });
    } finally {
      setCodexBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-3 text-sm text-amber-200">
          {loadError}
        </div>
      )}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href={`/dashboard/projects/${projectId}`} className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white">Back</Link>
          <h2 className="mt-1 text-xs font-bold uppercase tracking-widest text-white">Procurement</h2>
          <p className="text-[11px] text-gray-500">{projectName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createFromBrief()}
            disabled={codexBusy || !codexBrief.trim()}
            className="inline-flex h-9 items-center rounded-full border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-4 text-[11px] font-bold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/15 disabled:opacity-50"
          >
            {codexBusy ? "Creating..." : "Build from notes"}
          </button>
          <button
            type="button"
            onClick={() => void autopackEstimate()}
            disabled={autopackRunning}
            className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/5 px-4 text-[11px] font-bold uppercase tracking-widest text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            {autopackRunning ? "Building..." : "Build quote request"}
          </button>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
          >
            Create quote request
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-white/40">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-10 text-center text-sm text-white/50">
          <div className="mx-auto mb-4 max-w-2xl rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">Build from notes</div>
            <textarea
              value={codexBrief}
              onChange={(event) => setCodexBrief(event.target.value)}
              placeholder="Example: Create a quote request for the storm drain package due 2026-08-18. Need 240 LF of 12-inch RCP, 8 EA catch basins, and 500 LF of trench safety."
              className="min-h-[100px] w-full rounded-lg border border-white/10 bg-[#090A0C] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
            />
          </div>
          No quote requests yet. Use the notes above or click <b>Create quote request</b> to build one from estimate items.
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href={`/dashboard/projects/${projectId}?phase=Estimating&sub=estimate`} className="inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white">
              Open estimate
            </Link>
            <Link href={`/dashboard/projects/${projectId}?phase=Documents&sub=documents`} className="inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white">
              Open documents
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {batches.map((batch) => (
            <div key={batch.batch_id} className="overflow-hidden rounded-xl border border-white/10 bg-[#0E0F12]">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-semibold text-white">{batch.batch_label || "Untitled quote request"}</div>
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
                          <div className="text-[10px] text-white/40">{item.quantity.toLocaleString()} {item.unit ?? ""} • {item.status.toUpperCase()}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyVendorLink(item.id)}
                          className="font-mono text-[10px] uppercase tracking-widest text-[#00D2FF] hover:opacity-70"
                        >
                          {copiedId === item.id ? "Link copied" : "Copy vendor link"}
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
                                <td className={`py-1 pr-2 text-right font-mono ${b.unit_price === lowest ? "font-bold text-[#CCFF00]" : "text-white/70"}`}>
                                  ${b.unit_price.toFixed(2)}{b.unit_price === lowest ? " ★" : ""}
                                </td>
                                <td className="py-1 pr-2 text-right text-white/60">{b.lead_time_days != null ? `${b.lead_time_days}d` : "-"}</td>
                                <td className="py-1 pr-2 text-[10px] uppercase text-white/50">{b.status}</td>
                                <td className="py-1 text-right">
                                  {b.status === "pending" && item.status === "open" && (
                                    <button
                                      type="button"
                                      onClick={() => approve(b.id)}
                                      disabled={approvingId === b.id}
                                      className="rounded-full border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40"
                                    >
                                      {approvingId === b.id ? "Issuing..." : "Approve and generate PO"}
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
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0E0F12]">
            {purchaseOrders.map((po) => (
              <div key={po.id} className="flex items-center justify-between px-4 py-2 text-xs">
                <span className="font-mono text-white/80">PO #{po.po_number}</span>
                <span className="font-mono text-[#CCFF00]">${Number(po.total_amount).toFixed(2)}</span>
                <span className="text-[10px] uppercase text-white/40">{po.status}</span>
                <span className="text-[10px] text-white/30">{po.email_sent_at ? "Emailed" : "Not emailed"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {wizardOpen && (
        <QuotePackagingWizard
          projectId={projectId}
          onClose={() => setWizardOpen(false)}
          onDone={async () => {
            setWizardOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function QuotePackagingWizard({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [batchLabel, setBatchLabel] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/estimate/current?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { rows?: EstimateRow[] }) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggle = (i: number) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
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
        toast({ title: String(`Package failed: ${err.error ?? res.status}`), kind: "error" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[#0E0F12] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Package estimate items as a quote</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">×</button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Quote label</span>
            <input
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="e.g. Concrete package"
              className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Needed By</span>
            <input
              type="date"
              value={requiredDate}
              onChange={(e) => setRequiredDate(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none"
            />
          </label>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-white/40">Loading estimate rows...</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-white/40">No estimate rows found yet. Add a takeoff or import estimate items to get started.</div>
        ) : (
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0A0A0B]">
                <tr className="text-left text-[9px] uppercase tracking-widest text-white/40">
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                  <th className="px-2 py-1.5">Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? i} className="cursor-pointer border-t border-white/5 hover:bg-white/[0.02]" onClick={() => toggle(i)}>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={checked.has(i)}
                        onChange={() => toggle(i)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
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
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={selectedCount === 0 || submitting}
              className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
            >
              {submitting ? "Packaging..." : "Create quote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
