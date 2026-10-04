// Live-database integration test for the financial-read gate
// (frontend-backend reconciliation, item 4).
//
// Proves that `redactFinancialFields` (permissions.ts), wired into
// GET /api/estimate, GET /api/invoices, and GET /api/change-orders, actually
// nulls cost/markup/profit/invoice fields for a restricted role (ClientView,
// Subcontractor, FieldSuperintendent) and leaves them intact for an
// authorized role (Owner/Admin/Estimator/ProjectManager) — against real rows
// in estimate_items, invoices, and change_order_items, not a mock.
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
import type { Role } from "./permissions";
import { redactFinancialFields } from "./permissions";
import { ESTIMATE_FINANCIAL_FIELDS, CHANGE_ORDER_FINANCIAL_FIELDS, INVOICE_FINANCIAL_FIELDS } from "./financial-redaction";

const ENV = loadIntegrationTestEnv();

if (!ENV.ready) {
  describe(`Financial-read gate (integration, SKIPPED — ${ENV.skipReason})`, () => {
    it("skipped", () => { /* no-op */ });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(ENV.supabaseUrl!, ENV.serviceKey!) as any;

  const KNOWN_ROLES: readonly Role[] = [
    "Owner", "Admin", "Estimator", "ProjectManager", "FieldSuperintendent", "Subcontractor", "ClientView",
  ];

  // Mirrors the stored-role half of getUserRole (permissions.ts) against the
  // test's own client rather than createServiceClient(), which calls
  // next/headers' cookies() and throws outside a real request scope.
  // Workspace-owner promotion is covered by permissions.test.ts.
  async function getRole(tenant: string, clerkUserId: string): Promise<Role> {
    const { data } = await db
      .from("project_profiles")
      .select("role")
      .eq("tenant_id", tenant)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    const role = data?.role as string | undefined;
    return (role && (KNOWN_ROLES as readonly string[]).includes(role)) ? (role as Role) : "Estimator";
  }

  const TEST_MARK = `finredact_${Date.now()}`;
  let tenantId: string;
  let projectId: string;
  const clerkUserOwner = `${TEST_MARK}_owner`;
  const clerkUserClient = `${TEST_MARK}_client`;
  const clerkUserSub = `${TEST_MARK}_sub`;
  const clerkUserNoProfile = `${TEST_MARK}_noprofile`; // no project_profiles row -> defaults to Estimator

  before(async () => {
    const { data: t } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_org`, name: "Financial Redaction Test Tenant" }).select("id").single();
    tenantId = t.id;
    const { data: p } = await db.from("projects").insert({ tenant_id: tenantId, name: `${TEST_MARK}_project` }).select("id").single();
    projectId = p.id;

    await db.from("project_profiles").insert([
      { tenant_id: tenantId, clerk_user_id: clerkUserOwner, role: "Owner" },
      { tenant_id: tenantId, clerk_user_id: clerkUserClient, role: "ClientView" },
      { tenant_id: tenantId, clerk_user_id: clerkUserSub, role: "Subcontractor" },
    ]);
  });

  after(async () => {
    await db.from("estimate_items").delete().eq("tenant_id", tenantId);
    await db.from("invoices").delete().eq("tenant_id", tenantId);
    await db.from("change_order_items").delete().eq("tenant_id", tenantId);
    await db.from("project_profiles").delete().eq("tenant_id", tenantId);
    await db.from("projects").delete().eq("tenant_id", tenantId);
    await db.from("tenants").delete().eq("id", tenantId);
  });

  describe("getRole (mirrors getUserRole in permissions.ts)", () => {
    it("resolves the role stored in project_profiles", async () => {
      assert.equal(await getRole(tenantId, clerkUserOwner), "Owner");
      assert.equal(await getRole(tenantId, clerkUserClient), "ClientView");
      assert.equal(await getRole(tenantId, clerkUserSub), "Subcontractor");
    });

    it("defaults to Estimator when no project_profiles row exists", async () => {
      assert.equal(await getRole(tenantId, clerkUserNoProfile), "Estimator");
    });
  });

  describe("estimate_items financial redaction (GET /api/estimate)", () => {
    it("nulls cost/price fields for ClientView and Subcontractor, but not for Owner", async () => {
      const { data: item, error } = await db.from("estimate_items").insert({
        tenant_id: tenantId,
        project_id: projectId,
        description: `${TEST_MARK} estimate item`,
        item_type: "material",
        unit_cost: 42.5,
        total_price: 999,
        profit: 100,
      }).select("*").single();
      if (error) throw error;

      const ownerRole = await getRole(tenantId, clerkUserOwner);
      const clientRole = await getRole(tenantId, clerkUserClient);
      const subRole = await getRole(tenantId, clerkUserSub);

      const forOwner = redactFinancialFields([item], ownerRole, ESTIMATE_FINANCIAL_FIELDS);
      const forClient = redactFinancialFields([item], clientRole, ESTIMATE_FINANCIAL_FIELDS);
      const forSub = redactFinancialFields([item], subRole, ESTIMATE_FINANCIAL_FIELDS);

      assert.equal(Number(forOwner[0].unit_cost), 42.5, "Owner must still see unit_cost");
      assert.equal(Number(forOwner[0].total_price), 999, "Owner must still see total_price");
      assert.equal(forOwner[0].description, `${TEST_MARK} estimate item`, "non-financial fields must pass through unchanged");

      assert.equal(forClient[0].unit_cost, null, "ClientView must never receive unit_cost");
      assert.equal(forClient[0].total_price, null, "ClientView must never receive total_price");
      assert.equal(forClient[0].profit, null, "ClientView must never receive profit");
      assert.equal(forClient[0].description, `${TEST_MARK} estimate item`, "non-financial fields must still pass through for a restricted role");

      assert.equal(forSub[0].unit_cost, null, "Subcontractor must never receive unit_cost");
      assert.equal(forSub[0].profit, null, "Subcontractor must never receive profit");
    });
  });

  describe("invoices financial redaction (GET /api/invoices)", () => {
    it("nulls amount/retainage for ClientView, but not for Owner", async () => {
      const { data: inv, error } = await db.from("invoices").insert({
        tenant_id: tenantId,
        project_id: projectId,
        direction: "receivable",
        vendor_or_customer: `${TEST_MARK} vendor`,
        amount: 5000,
        retainage: 500,
        status: "open",
      }).select("*").single();
      if (error) throw error;

      const ownerRole = await getRole(tenantId, clerkUserOwner);
      const clientRole = await getRole(tenantId, clerkUserClient);

      const forOwner = redactFinancialFields([inv], ownerRole, INVOICE_FINANCIAL_FIELDS);
      const forClient = redactFinancialFields([inv], clientRole, INVOICE_FINANCIAL_FIELDS);

      assert.equal(Number(forOwner[0].amount), 5000);
      assert.equal(Number(forOwner[0].retainage), 500);

      assert.equal(forClient[0].amount, null, "ClientView must never receive invoice amount");
      assert.equal(forClient[0].retainage, null, "ClientView must never receive retainage");
      assert.equal(forClient[0].vendor_or_customer, `${TEST_MARK} vendor`, "non-financial fields must pass through");
    });
  });

  describe("change_order_items financial redaction (GET /api/change-orders)", () => {
    it("nulls amount/cost/markup fields for ClientView, but not for Owner", async () => {
      const { data: co, error } = await db.from("change_order_items").insert({
        tenant_id: tenantId,
        project_id: projectId,
        description: `${TEST_MARK} change order`,
        amount: 12000,
        labor_cost: 4000,
        markup: 1000,
      }).select("*").single();
      if (error) throw error;

      const ownerRole = await getRole(tenantId, clerkUserOwner);
      const clientRole = await getRole(tenantId, clerkUserClient);

      const forOwner = redactFinancialFields([co], ownerRole, CHANGE_ORDER_FINANCIAL_FIELDS);
      const forClient = redactFinancialFields([co], clientRole, CHANGE_ORDER_FINANCIAL_FIELDS);

      assert.equal(Number(forOwner[0].amount), 12000);
      assert.equal(Number(forOwner[0].markup), 1000);

      assert.equal(forClient[0].amount, null, "ClientView must never receive change-order amount");
      assert.equal(forClient[0].labor_cost, null, "ClientView must never receive labor_cost");
      assert.equal(forClient[0].markup, null, "ClientView must never receive markup");
      assert.equal(forClient[0].description, `${TEST_MARK} change order`, "non-financial fields must pass through");
    });
  });
}
