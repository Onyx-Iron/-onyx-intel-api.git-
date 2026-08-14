"use client";

import { useEffect, useState } from "react";

interface RequestInfo {
  id: string;
  item_description: string;
  quantity: number;
  unit: string | null;
  required_date: string | null;
  status: "open" | "awarded" | "cancelled";
  project_name: string | null;
}

export default function PublicBidForm({ requestId }: { requestId: string }) {
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");

  const [vendorName, setVendorName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [notes, setNotes] = useState("");

  function applyBrief(value: string) {
    const text = value.trim();
    const normalized = text.toLowerCase();
    const priceMatch = text.match(/\$([\d,]+(?:\.\d+)?)|\b(?:price|unit price|rate)\s+([\d,]+(?:\.\d+)?)\b/i);
    const leadMatch = text.match(/\b(?:lead time|lead|delivery|ship(?:ping)?)\s*(?:is|of|:)?\s*(\d{1,3})\s*(?:days?|d)\b/i);
    const vendorMatch = text.match(/(?:from|vendor|company|by)\s+["']?([^,"'\n]+)["']?/i);
    const noteMatch = text.match(/(?:notes?|note)\s*[:\-]\s*([^;\n]+)$/i);

    if (vendorMatch?.[1]) setVendorName(vendorMatch[1].trim());
    if (priceMatch?.[1] || priceMatch?.[2]) setUnitPrice(String(Number(priceMatch[1] ?? priceMatch[2])));
    if (leadMatch?.[1]) setLeadTimeDays(leadMatch[1]);
    if (noteMatch?.[1]) setNotes(noteMatch[1].trim());
    else if (normalized.includes("include")) setNotes((prev) => prev || text);
  }

  useEffect(() => {
    fetch(`/api/public/procurement-request/${encodeURIComponent(requestId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Request ${r.status}`);
        return r.json() as Promise<RequestInfo>;
      })
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [requestId]);

  async function submit() {
    setSubmitError(null);
    const price = Number(unitPrice);
    if (!vendorName.trim() || !contactEmail.trim() || !Number.isFinite(price) || price <= 0) {
      setSubmitError("Company name, email, and a unit price above 0 are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/procurement/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          vendor_name: vendorName,
          contact_email: contactEmail,
          unit_price: price,
          lead_time_days: leadTimeDays ? Number(leadTimeDays) : undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error ?? `Submission failed (${res.status}). Please review your details and try again.`);
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="w-full max-w-md rounded-xl border border-[#E50914]/20 bg-[#E50914]/[0.05] p-6 text-center">
        <p className="text-[#E50914] text-sm">{loadError}</p>
      </div>
    );
  }
  if (!info) {
    return <div className="text-white/40 text-sm">Loading request...</div>;
  }
  if (info.status !== "open") {
    return (
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-6 text-center">
        <p className="text-sm text-white/70">This request is no longer accepting bids.</p>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className="w-full max-w-md rounded-xl border border-[#CCFF00]/20 bg-[#CCFF00]/[0.05] p-6 text-center">
        <p className="text-[#CCFF00] text-sm font-semibold">Quote submitted - thank you.</p>
        <p className="mt-1 text-xs text-white/50">The buyer will follow up if your bid is selected.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-6">
      <div className="mb-1 text-[10px] uppercase tracking-widest font-mono text-white/40">
        {info.project_name ? `${info.project_name} - ` : ""}Quote request
      </div>
      <h1 className="text-lg font-bold text-white mb-1">{info.item_description}</h1>
      <p className="mb-4 text-sm text-white/60">
        {info.quantity.toLocaleString()} {info.unit ?? ""}{info.required_date ? ` - needed by ${info.required_date}` : ""}
      </p>

      {submitError && <div className="mb-3 rounded border border-[#E50914]/30 bg-[#E50914]/10 px-3 py-2 text-xs text-[#E50914]">{submitError}</div>}

      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Paste a quote note</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onBlur={(e) => applyBrief(e.target.value)}
            placeholder='Optional: paste "ACME 48.50 lead 7 days notes: includes delivery" and the form will fill the fields.'
            rows={2}
            className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Company name</span>
          <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Contact email</span>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-white/40">Unit price ($)</span>
            <input type="number" step="0.01" min="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-white/40">Lead time (days)</span>
            <input type="number" min="0" step="1" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#CCFF00]" />
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-5 w-full inline-flex h-11 items-center justify-center rounded-full bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-40"
      >
        {submitting ? "Submitting..." : "Send quote"}
      </button>
    </div>
  );
}
