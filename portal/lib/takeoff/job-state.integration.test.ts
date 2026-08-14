import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const integrationEnv = loadIntegrationTestEnv();

describe("takeoff job transitions (live database)", { skip: !integrationEnv.ready && integrationEnv.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(integrationEnv.supabaseUrl as string, integrationEnv.serviceKey as string) as any;
  const mark = `takeoff_job_${Date.now()}`;
  let tenantId: string;
  let otherTenantId: string;
  let projectId: string;
  let jobId: string;

  before(async () => {
    const { data: tenant, error: tenantError } = await db.from("tenants")
      .insert({ clerk_org_id: `${mark}_tenant`, name: "Takeoff Job Test" }).select("id").single();
    if (tenantError) throw tenantError;
    tenantId = tenant.id;

    const { data: otherTenant, error: otherTenantError } = await db.from("tenants")
      .insert({ clerk_org_id: `${mark}_other`, name: "Other Takeoff Job Test" }).select("id").single();
    if (otherTenantError) throw otherTenantError;
    otherTenantId = otherTenant.id;

    const { data: project, error: projectError } = await db.from("projects")
      .insert({ tenant_id: tenantId, name: `${mark}_project` }).select("id").single();
    if (projectError) throw projectError;
    projectId = project.id;

    const { data: job, error: jobError } = await db.from("takeoff_jobs").insert({
      tenant_id: tenantId,
      project_id: projectId,
      scope_snapshot: { mode: "complete", documentIds: [] },
      scope_hash: "test-scope-hash",
      created_by: "test-user",
    }).select("id").single();
    if (jobError) throw jobError;
    jobId = job.id;
  });

  after(async () => {
    if (jobId) await db.from("takeoff_job_events").delete().eq("job_id", jobId);
    if (jobId) await db.from("takeoff_job_units").delete().eq("job_id", jobId);
    if (jobId) await db.from("takeoff_jobs").delete().eq("id", jobId);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
    if (otherTenantId) await db.from("tenants").delete().eq("id", otherTenantId);
  });

  it("atomically transitions with optimistic concurrency and appends an event", async () => {
    const { data, error } = await db.rpc("transition_takeoff_state", {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_entity_type: "job",
      p_entity_id: jobId,
      p_expected_row_version: 0,
      p_next_state: "validated",
      p_actor_user_id: "test-user",
      p_reason: "documents validated",
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.state, "validated");
    assert.equal(data.row_version, 1);

    const { data: events } = await db.from("takeoff_job_events")
      .select("from_state,to_state,from_row_version,to_row_version,actor_user_id")
      .eq("job_id", jobId);
    assert.deepEqual(events, [{
      from_state: "uploaded",
      to_state: "validated",
      from_row_version: 0,
      to_row_version: 1,
      actor_user_id: "test-user",
    }]);
  });

  it("rejects stale, illegal, and cross-tenant transitions without changing the row", async () => {
    for (const args of [
      { p_tenant_id: tenantId, p_expected_row_version: 0, p_next_state: "split" },
      { p_tenant_id: tenantId, p_expected_row_version: 1, p_next_state: "approved" },
      { p_tenant_id: otherTenantId, p_expected_row_version: 1, p_next_state: "split" },
    ]) {
      const { error } = await db.rpc("transition_takeoff_state", {
        p_job_id: jobId,
        p_entity_type: "job",
        p_entity_id: jobId,
        p_actor_user_id: "test-user",
        p_reason: "must fail",
        ...args,
      });
      assert.ok(error);
    }

    const { data: job } = await db.from("takeoff_jobs").select("state,row_version").eq("id", jobId).single();
    assert.deepEqual(job, { state: "validated", row_version: 1 });
  });
});
