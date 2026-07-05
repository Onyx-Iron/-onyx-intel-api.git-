import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { requireGoogleToken } from "@/lib/google/api";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

function buildRaw(to: string, subject: string, body: string): string {
  const headers = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"'].join("\r\n");
  const msg = `${headers}\r\n\r\n${body}`;
  return Buffer.from(msg, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * POST /api/procurement/bids/[id]/approve — "Approve & Generate PO".
 *
 * Awards the bid, locks in a purchase_orders record (net commitment =
 * unit_price × the originating request's quantity), marks the sibling bids
 * on the same request as declined, and best-effort emails the winning
 * vendor. A missing/unconnected Google account does NOT fail the approval —
 * the PO is the authoritative record; the email is a courtesy notification.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: bidId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { terms?: string };

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: bid, error: bidErr } = await anyDb
    .from("vendor_bids")
    .select("id, tenant_id, request_id, vendor_name, contact_email, unit_price, status")
    .eq("id", bidId).eq("tenant_id", tenantId)
    .maybeSingle();
  if (bidErr) return NextResponse.json({ error: bidErr.message }, { status: 500 });
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.status === "awarded") return NextResponse.json({ error: "This bid has already been awarded." }, { status: 409 });

  const { data: request, error: reqErr } = await anyDb
    .from("marketplace_requests")
    .select("id, project_id, quantity, unit, item_description, status")
    .eq("id", bid.request_id).eq("tenant_id", tenantId)
    .single();
  if (reqErr || !request) return NextResponse.json({ error: reqErr?.message ?? "Request not found" }, { status: 404 });
  if (request.status === "awarded") return NextResponse.json({ error: "This request has already been awarded." }, { status: 409 });

  const totalAmount = Number(bid.unit_price) * Number(request.quantity);

  const { data: po, error: poErr } = await anyDb.from("purchase_orders").insert({
    tenant_id: tenantId,
    project_id: request.project_id,
    vendor_bid_id: bid.id,
    total_amount: totalAmount,
    terms: body.terms ?? null,
    status: "issued",
    created_by: userId,
  }).select("*").single();
  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 });

  await Promise.all([
    anyDb.from("vendor_bids").update({ status: "awarded" }).eq("id", bid.id),
    anyDb.from("vendor_bids").update({ status: "declined" }).eq("request_id", bid.request_id).neq("id", bid.id),
    anyDb.from("marketplace_requests").update({ status: "awarded", updated_at: new Date().toISOString() }).eq("id", request.id),
  ]);

  // Best-effort vendor notification — never blocks the approval itself.
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";
  try {
    const t = await requireGoogleToken();
    if (t.ok) {
      const subject = `Purchase Order #${po.po_number} — ${request.item_description}`;
      const emailBody = [
        `You've been awarded PO #${po.po_number} for ${request.quantity} ${request.unit ?? ""} of "${request.item_description}".`,
        `Unit price: $${Number(bid.unit_price).toFixed(2)}`,
        `Total: $${totalAmount.toFixed(2)}`,
        body.terms ? `Terms: ${body.terms}` : "",
        "",
        "Please confirm receipt and delivery timeline.",
      ].filter(Boolean).join("\n");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: buildRaw(bid.contact_email, subject, emailBody) }),
      });
      if (res.ok) {
        emailStatus = "sent";
        await anyDb.from("purchase_orders").update({ email_sent_at: new Date().toISOString() }).eq("id", po.id);
      } else {
        emailStatus = "failed";
      }
    }
  } catch {
    emailStatus = "failed";
  }

  void logEvent({
    projectId: request.project_id,
    tenantId, userId,
    entityType: "procurement",
    entityId: po.id,
    action: "created",
    title: `PO #${po.po_number} issued to ${bid.vendor_name} — $${totalAmount.toFixed(2)}`,
    meta: { vendor: bid.vendor_name, total_amount: totalAmount, email_status: emailStatus },
  });

  return NextResponse.json({ ok: true, purchase_order: po, email_status: emailStatus });
}
