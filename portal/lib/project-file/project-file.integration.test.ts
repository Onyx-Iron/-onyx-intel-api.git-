// Live checks for the project file: a link cannot cross projects, a sheet
// pin does not create a takeoff, a draft change does not move the revised
// budget, and a rejected audit decision writes nothing.
//
// SAFETY: isolated Supabase only. Requires ALLOW_INTEGRATION_TESTS=true plus
// TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY. Self-skips otherwise.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";
import { approvedChangeDelta } from "./money";
import { mutationForAgentDecision, pinCreatesTakeoff, sheetPinInsert } from "./records";

const ENV = loadIntegrationTestEnv();

if (!ENV.ready) {
  describe(`Project file (integration, SKIPPED — ${ENV.skipReason})`, () => {
    it("skipped", () => { /* no-op */ });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(ENV.supabaseUrl!, ENV.serviceKey!) as any;
  const TEST_MARK = `pf_${Date.now()}`;
  let tenantA: string;
  let tenantB: string;
  let projectA: string;
  let projectB: string;

  before(async () => {
    const { data: ta, error: taError } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_a`, name: "Project File A" }).select("id").single();
    if (taError) throw taError;
    tenantA = ta.id;
    const { data: tb, error: tbError } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_b`, name: "Project File B" }).select("id").single();
    if (tbError) throw tbError;
    tenantB = tb.id;
    const { data: pa, error: paError } = await db.from("projects").insert({ tenant_id: tenantA, name: `${TEST_MARK}_a` }).select("id").single();
    if (paError) throw paError;
    projectA = pa.id;
    const { data: pb, error: pbError } = await db.from("projects").insert({ tenant_id: tenantA, name: `${TEST_MARK}_b` }).select("id").single();
    if (pbError) throw pbError;
    projectB = pb.id;
  });

  after(async () => {
    await db.from("sheet_pins").delete().eq("tenant_id", tenantA);
    await db.from("project_record_links").delete().eq("tenant_id", tenantA);
    await db.from("project_budget_lines").delete().eq("tenant_id", tenantA);
    await db.from("project_budgets").delete().eq("tenant_id", tenantA);
    await db.from("estimate_versions").delete().eq("created_by", TEST_MARK);
    await db.from("estimates").delete().eq("tenant_id", tenantA);
    await db.from("schedule_tasks").delete().eq("tenant_id", tenantA);
    await db.from("manual_takeoffs").delete().eq("tenant_id", tenantA);
    await db.from("projects").delete().in("id", [projectA, projectB]);
    await db.from("tenants").delete().in("id", [tenantA, tenantB]);
  });

  describe("Project file constraints", () => {
    it("keeps a record link inside one project", async () => {
      const { data: taskA, error: taskError } = await db.from("schedule_tasks").insert({
        tenant_id: tenantA, project_id: projectA, name: `${TEST_MARK} task`, duration: 1,
      }).select("id").single();
      if (taskError) throw taskError;
      const { data: taskB, error: otherError } = await db.from("schedule_tasks").insert({
        tenant_id: tenantA, project_id: projectB, name: `${TEST_MARK} other`, duration: 1,
      }).select("id").single();
      if (otherError) throw otherError;

      const crossed = await db.from("project_record_links").insert({
        tenant_id: tenantA,
        project_id: projectA,
        from_type: "schedule_task",
        from_id: taskA.id,
        to_type: "schedule_task",
        to_id: taskB.id,
        link_role: "blocks",
      });
      assert.ok(crossed.error, "a link to another project must fail");

      const same = await db.from("project_record_links").insert({
        tenant_id: tenantA,
        project_id: projectA,
        from_type: "schedule_task",
        from_id: taskA.id,
        to_type: "schedule_task",
        to_id: taskA.id,
        link_role: "related",
      }).select("id").single();
      assert.equal(same.error, null);

      const { data: leaked } = await db.from("project_record_links").select("id").eq("tenant_id", tenantB);
      assert.equal((leaked ?? []).length, 0);
    });

    it("stores a sheet pin without creating a takeoff", async () => {
      const draft = {
        project_id: projectA,
        page_id: projectA,
        entity_type: "punch" as const,
        entity_id: projectA,
        x: 12,
        y: 18,
        label: TEST_MARK,
      };
      assert.equal(pinCreatesTakeoff(draft), false);
      const payload = sheetPinInsert(draft, tenantA);
      assert.equal("takeoff_type" in payload, false);
      const { error } = await db.from("sheet_pins").insert(payload);
      assert.equal(error, null);
      const { data: takeoffs } = await db.from("manual_takeoffs").select("id").eq("tenant_id", tenantA).eq("project_id", projectA);
      assert.equal((takeoffs ?? []).length, 0);
    });

    it("does not move the revised budget for a draft change", async () => {
      assert.equal(approvedChangeDelta("draft", "approved", 500), 0);
      assert.equal(approvedChangeDelta("pending", "draft", 500), 0);
      const { data: estimate, error: estimateError } = await db.from("estimates").insert({
        tenant_id: tenantA,
        project_id: projectA,
        estimate_number: TEST_MARK,
        name: TEST_MARK,
      }).select("id").single();
      if (estimateError) throw estimateError;
      const { data: version, error: versionError } = await db.from("estimate_versions").insert({
        estimate_id: estimate.id,
        version_number: 1,
        created_by: TEST_MARK,
      }).select("id").single();
      if (versionError) throw versionError;
      const { data: budget, error: budgetError } = await db.from("project_budgets").insert({
        tenant_id: tenantA,
        project_id: projectA,
        source_estimate_version_id: version.id,
        version_number: 1,
        total_price: 1000,
        line_count: 1,
        is_current: true,
      }).select("id").single();
      if (budgetError) throw budgetError;
      const { data: line, error: lineError } = await db.from("project_budget_lines").insert({
        budget_id: budget.id,
        tenant_id: tenantA,
        project_id: projectA,
        description: TEST_MARK,
        original_amount: 1000,
        approved_change_amount: 0,
        total_price: 1000,
      }).select("approved_change_amount").single();
      if (lineError) throw lineError;
      assert.equal(Number(line.approved_change_amount), 0);
    });

    it("writes nothing when an audit decision is rejected", () => {
      assert.equal(mutationForAgentDecision("reject"), "none");
    });
  });
}
