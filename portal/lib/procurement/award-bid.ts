/**
 * Issue one purchase order for a marketplace bid.
 *
 * The request row is claimed before the purchase order is inserted. A unique
 * key on vendor_bid_id does not stop two different bids on the same request
 * from each inserting an issued PO when Approve is clicked twice.
 */

export interface AwardBidCommand {
  tenantId: string;
  userId: string;
  terms: string | null;
  bid: {
    id: string;
    request_id: string;
    unit_price: number | string;
  };
  request: {
    id: string;
    project_id: string;
    quantity: number | string;
    status: string;
  };
}

export interface IssuedPurchaseOrder {
  id: string;
  total_amount: number;
  [key: string]: unknown;
}

export type AwardBidResult =
  | { ok: true; purchaseOrder: IssuedPurchaseOrder; totalAmount: number }
  | { ok: false; status: 409 | 500; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function issueAwardedPurchaseOrder(
  db: AnyDb,
  command: AwardBidCommand,
  isUniqueViolation: (error: { code?: string; message?: string } | null | undefined) => boolean,
): Promise<AwardBidResult> {
  const totalAmount = Number(command.bid.unit_price) * Number(command.request.quantity);
  const now = new Date().toISOString();

  const { data: claimed, error: claimErr } = await db
    .from("marketplace_requests")
    .update({ status: "awarded", updated_at: now })
    .eq("id", command.request.id)
    .eq("tenant_id", command.tenantId)
    .neq("status", "awarded")
    .select("id");
  if (claimErr) return { ok: false, status: 500, error: claimErr.message };
  if (!claimed?.length) {
    return { ok: false, status: 409, error: "This request was awarded concurrently. Refresh and retry." };
  }

  const { data: po, error: poErr } = await db.from("purchase_orders").insert({
    tenant_id: command.tenantId,
    project_id: command.request.project_id,
    vendor_bid_id: command.bid.id,
    total_amount: totalAmount,
    terms: command.terms,
    status: "issued",
    created_by: command.userId,
  }).select("*").single();
  if (poErr || !po) {
    await db.from("marketplace_requests")
      .update({ status: command.request.status, updated_at: new Date().toISOString() })
      .eq("id", command.request.id)
      .eq("tenant_id", command.tenantId)
      .eq("status", "awarded");
    if (isUniqueViolation(poErr)) {
      return { ok: false, status: 409, error: "A purchase order already exists for this bid." };
    }
    return { ok: false, status: 500, error: poErr?.message ?? "Could not create the purchase order." };
  }

  const { data: awardedBid, error: awardErr } = await db.from("vendor_bids")
    .update({ status: "awarded" })
    .eq("id", command.bid.id)
    .eq("tenant_id", command.tenantId)
    .eq("status", "pending")
    .select("id");
  if (awardErr || !awardedBid?.length) {
    await db.from("purchase_orders").delete().eq("id", po.id).eq("tenant_id", command.tenantId);
    await db.from("marketplace_requests")
      .update({ status: command.request.status, updated_at: new Date().toISOString() })
      .eq("id", command.request.id)
      .eq("tenant_id", command.tenantId)
      .eq("status", "awarded");
    return {
      ok: false,
      status: awardErr ? 500 : 409,
      error: awardErr?.message ?? "This bid was already awarded concurrently. Refresh and retry.",
    };
  }

  await db.from("vendor_bids")
    .update({ status: "declined" })
    .eq("request_id", command.bid.request_id)
    .eq("tenant_id", command.tenantId)
    .neq("id", command.bid.id)
    .eq("status", "pending");

  return { ok: true, purchaseOrder: po as IssuedPurchaseOrder, totalAmount };
}
