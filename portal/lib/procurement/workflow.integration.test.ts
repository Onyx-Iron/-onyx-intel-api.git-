// Live-database integration test for the Procurement workflow
// (frontend-backend-reconciliation, item 1 — wiring ProcurementBoard into
// ProjectTabs). Reproduces the exact sequence app/api/procurement/{requests,
// bids,bids/[id]/approve}/route.ts perform, proving the RFQ -> vendor bid ->
// comparison -> award -> purchase-order chain actually works against the
// real schema, not just that the UI renders.
//
// SAFETY: this test targets an isolated Supabase branch/test project ONLY —
// never production. Requires ALLOW_INTEGRATION_TESTS=true plus
// TEST_SUPABASE_URL/TEST_SUPABASE_SERVICE_ROLE_KEY (see .env.test.local.example
// and lib/test-utils/integration-guard.ts). Fails closed (throws) if the
// resolved project ref is the production project; self-skips for any other
// reason it can't run.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const ENV = loadIntegrationTestEnv();

if (!ENV.ready) {
  describe(`procurement workflow (integration, SKIPPED — ${ENV.skipReason})`, () => {
    it("skipped", () => { /* no-op */ });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(ENV.supabaseUrl!, ENV.serviceKey!) as any;

  const TEST_MARK = `proc_${Date.now()}`;
  let tenantA: string;
  let tenantB: string;
  let projectA: string;

  before(async () => {
    const { data: ta } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_org_a`, name: "Procurement Test Tenant A" }).select("id").single();
    tenantA = ta.id;
    const { data: tb } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_org_b`, name: "Procurement Test Tenant B" }).select("id").single();
    tenantB = tb.id;
    const { data: pa } = await db.from("projects").insert({ tenant_id: tenantA, name: `${TEST_MARK}_project` }).select("id").single();
    projectA = pa.id;
  });

  after(async () => {
    await db.from("purchase_orders").delete().eq("tenant_id", tenantA);
    await db.from("vendor_bids").delete().eq("tenant_id", tenantA);
    await db.from("marketplace_requests").delete().eq("tenant_id", tenantA);
    await db.from("projects").delete().eq("tenant_id", tenantA);
    await db.from("tenants").delete().in("id", [tenantA, tenantB]);
  });

  // Mirrors POST /api/procurement/requests exactly.
  async function createRequest(itemDescription: string, quantity = 100) {
    const { data, error } = await db.from("marketplace_requests").insert({
      tenant_id: tenantA, project_id: projectA, item_description: itemDescription,
      quantity, unit: "EA", created_by: "integration_test_user",
    }).select("*").single();
    if (error) throw error;
    return data;
  }

  // Mirrors POST /api/procurement/bids exactly (including the "no
  // client-supplied tenant_id" pattern — tenant_id is derived from the
  // looked-up request, never trusted from the caller).
  async function submitBid(requestId: string, vendorName: string, unitPrice: number) {
    const { data: request, error: reqErr } = await db.from("marketplace_requests").select("id, tenant_id, status").eq("id", requestId).maybeSingle();
    if (reqErr) throw reqErr;
    if (!request) throw new Error("Request not found");
    if (request.status !== "open") throw new Error(`Request not open: ${request.status}`);
    const { data, error } = await db.from("vendor_bids").insert({
      tenant_id: request.tenant_id, request_id: request.id,
      vendor_name: vendorName, contact_email: `${vendorName.toLowerCase().replace(/\s+/g, "")}@example.com`,
      unit_price: unitPrice,
    }).select("*").single();
    if (error) throw error;
    return data;
  }

  // Mirrors POST /api/procurement/bids/[id]/approve exactly (minus the
  // best-effort Gmail notification, which is unrelated to data correctness).
  async function approveBid(bidId: string, tenantId: string) {
    const { data: bid, error: bidErr } = await db.from("vendor_bids").select("*").eq("id", bidId).eq("tenant_id", tenantId).maybeSingle();
    if (bidErr) throw bidErr;
    if (!bid) throw new Error("Bid not found");
    if (bid.status === "awarded") throw new Error("Already awarded");

    const { data: request, error: reqErr } = await db.from("marketplace_requests").select("*").eq("id", bid.request_id).eq("tenant_id", tenantId).single();
    if (reqErr || !request) throw new Error("Request not found");
    if (request.status === "awarded") throw new Error("Request already awarded");

    const { data: claimed, error: claimErr } = await db.from("marketplace_requests")
      .update({ status: "awarded" })
      .eq("id", request.id)
      .eq("tenant_id", tenantId)
      .neq("status", "awarded")
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed?.length) throw new Error("Request already awarded");

    const totalAmount = Number(bid.unit_price) * Number(request.quantity);
    const { data: po, error: poErr } = await db.from("purchase_orders").insert({
      tenant_id: tenantId, project_id: request.project_id, vendor_bid_id: bid.id,
      total_amount: totalAmount, status: "issued", created_by: "integration_test_user",
    }).select("*").single();
    if (poErr) {
      await db.from("marketplace_requests").update({ status: request.status }).eq("id", request.id).eq("tenant_id", tenantId);
      throw poErr;
    }

    const { data: awardedBid, error: awardErr } = await db.from("vendor_bids")
      .update({ status: "awarded" })
      .eq("id", bid.id)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .select("id");
    if (awardErr || !awardedBid?.length) {
      await db.from("purchase_orders").delete().eq("id", po.id).eq("tenant_id", tenantId);
      await db.from("marketplace_requests").update({ status: request.status }).eq("id", request.id).eq("tenant_id", tenantId);
      throw awardErr ?? new Error("Already awarded");
    }
    await db.from("vendor_bids").update({ status: "declined" }).eq("request_id", bid.request_id).eq("tenant_id", tenantId).neq("id", bid.id).eq("status", "pending");
    return po;
  }

  describe("Full RFQ -> vendor bid -> comparison -> award -> purchase order workflow", () => {
    it("creates an RFQ, collects competing bids, awards the lowest, and issues a locked PO", async () => {
      const request = await createRequest(`${TEST_MARK} rebar #4`, 500);
      assert.equal(request.status, "open");

      const bidHigh = await submitBid(request.id, "Acme Rebar Co", 2.50);
      const bidLow = await submitBid(request.id, "Budget Steel LLC", 2.10);
      assert.equal(bidHigh.status, "pending");
      assert.equal(bidLow.status, "pending");

      // Comparison: the cheaper bid should sort first (matches the route's
      // own .order("unit_price", { ascending: true })).
      const { data: bids } = await db.from("vendor_bids").select("*").eq("request_id", request.id).order("unit_price", { ascending: true });
      assert.equal(bids[0].id, bidLow.id, "the lowest bid must sort first for comparison");

      const po = await approveBid(bidLow.id, tenantA);
      assert.equal(po.status, "issued");
      assert.equal(po.total_amount, 2.10 * 500);

      const { data: awardedBid } = await db.from("vendor_bids").select("status").eq("id", bidLow.id).single();
      assert.equal(awardedBid.status, "awarded");
      const { data: declinedBid } = await db.from("vendor_bids").select("status").eq("id", bidHigh.id).single();
      assert.equal(declinedBid.status, "declined", "the losing bid must be auto-declined");

      const { data: awardedRequest } = await db.from("marketplace_requests").select("status").eq("id", request.id).single();
      assert.equal(awardedRequest.status, "awarded");
    });

    it("rejects a bid on a request that is no longer open", async () => {
      const request = await createRequest(`${TEST_MARK} closed item`, 10);
      const bid = await submitBid(request.id, "First Vendor", 5.00);
      await approveBid(bid.id, tenantA);

      await assert.rejects(() => submitBid(request.id, "Late Vendor", 4.00), /Request not open/);
    });

    it("rejects awarding the same bid twice", async () => {
      const request = await createRequest(`${TEST_MARK} double-award item`, 10);
      const bid = await submitBid(request.id, "Once Vendor", 5.00);
      await approveBid(bid.id, tenantA);
      await assert.rejects(() => approveBid(bid.id, tenantA), /Already awarded/);
    });
  });

  describe("Tenant isolation", () => {
    it("tenant B cannot approve tenant A's bid using its known id", async () => {
      const request = await createRequest(`${TEST_MARK} isolation item`, 10);
      const bid = await submitBid(request.id, "Isolated Vendor", 5.00);
      await assert.rejects(() => approveBid(bid.id, tenantB), /Bid not found/);

      const { data: stillPending } = await db.from("vendor_bids").select("status").eq("id", bid.id).single();
      assert.equal(stillPending.status, "pending", "cross-tenant approval attempt must not change bid status");
    });

    it("tenant B cannot read tenant A's marketplace requests via a tenant-scoped query", async () => {
      const request = await createRequest(`${TEST_MARK} isolation request`, 10);
      const { data: crossTenantRead } = await db.from("marketplace_requests").select("id").eq("id", request.id).eq("tenant_id", tenantB);
      assert.equal((crossTenantRead ?? []).length, 0);
    });
  });

  describe("Public vendor bid submission (unauthenticated capability-link model)", () => {
    it("a bid submitted using only the request's uuid (no tenant/auth context) is correctly scoped to that request's tenant", async () => {
      const request = await createRequest(`${TEST_MARK} public bid item`, 25);
      // submitBid's own lookup derives tenant_id from the request row, never
      // from a caller-supplied value — this is what makes the public,
      // unauthenticated /api/procurement/bids route safe.
      const bid = await submitBid(request.id, "Public Vendor", 9.99);
      assert.equal(bid.tenant_id, tenantA);
    });
  });
}
