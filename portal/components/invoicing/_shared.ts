// Shared types + helpers for invoicing tabs.

export type InvoiceDirection = "receivable" | "payable";
export type InvoiceStatus = "open" | "paid" | "overdue" | "disputed" | "canceled";

export interface Invoice {
  id: string;
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

export interface LienWaiver {
  id: string;
  vendor_name: string;
  waiver_type: string;
  draw_number: string | null;
  amount: number | null;
  through_date: string | null;
  state: string | null;
  document_id: string | null;
  signed_at: string | null;
  signed_by: string | null;
  status: "pending" | "received" | "expired";
  notes: string | null;
}

export const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  open:     "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  paid:     "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  overdue:  "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  disputed: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  canceled: "bg-white/5 text-gray-500 border-white/10",
};

export const INPUT_CLS = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pickField(row: Record<string, string | number | null>, keys: string[]): string | null {
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[\s_\-#]/g, "");
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase().replace(/[\s_\-#]/g, "") === norm) {
        return rv == null ? null : String(rv);
      }
    }
  }
  return null;
}

/** Aging bucket from invoice_date relative to today. */
export function agingBucket(invoiceDate: string | null): "0-30" | "31-60" | "61-90" | "90+" | "—" {
  if (!invoiceDate) return "—";
  const d = new Date(invoiceDate);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
