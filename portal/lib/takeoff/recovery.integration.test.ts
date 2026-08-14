import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const env = loadIntegrationTestEnv();

describe("takeoff lease recovery (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `takeoff_recovery_${Date.now()}`;
  let tenantId = ""; let projectId = ""; let jobId = ""; let unitId = "";

  before(async () => {
    const { data: tenant, error: tenantError } = await db.from("tenants").insert({ clerk_org_id: mark, name: mark }).select("id").single();
    if (tenantError) throw tenantError; tenantId = tenant.id;
    const { data: project, error: projectError } = await db.from("projects").insert({ tenant_id: tenantId, name: mark }).select("id").single();
    if (projectError) throw projectError; projectId = project.id;
    const { data: job, error: jobError } = await db.from("takeoff_jobs").insert({ tenant_id: tenantId, project_id: projectId, scope_snapshot: { mode: "documents" }, scope_hash: mark, created_by: "test" }).select("id").single();
    if (jobError) throw jobError; jobId = job.id;
    const { data: unit, error: unitError } = await db.from("takeoff_job_units").insert({
      job_id: jobId, tenant_id: tenantId, project_id: projectId, unit_type: "document", source_id: mark,
      state: "extracted", lease_owner: "dead-worker", lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }).select("id").single();
    if (unitError) throw unitError; unitId = unit.id;
  });

  after(async () => {
    if (jobId) await db.from("takeoff_jobs").delete().eq("id", jobId);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  it("reclaims an expired lease exactly once across concurrent recovery calls", async () => {
    const [first, second] = await Promise.all([
      db.rpc("recover_expired_takeoff_units", { p_limit: 10, p_max_attempts: 8 }),
      db.rpc("recover_expired_takeoff_units", { p_limit: 10, p_max_attempts: 8 }),
    ]);
    assert.equal(first.error, null, first.error?.message);
    assert.equal(second.error, null, second.error?.message);
    assert.equal((first.data?.length ?? 0) + (second.data?.length ?? 0), 1);
    const { data: unit } = await db.from("takeoff_job_units").select("state,attempts,lease_owner,lease_expires_at,next_retry_at").eq("id", unitId).single();
    assert.equal(unit.state, "failed_retryable");
    assert.equal(unit.attempts, 1);
    assert.equal(unit.lease_owner, null);
    assert.equal(unit.lease_expires_at, null);
    assert.ok(unit.next_retry_at);
  });
});
