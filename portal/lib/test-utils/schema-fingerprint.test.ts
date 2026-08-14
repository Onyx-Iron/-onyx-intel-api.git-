import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTakeoffSchemaDocument,
  REQUIRED_TAKEOFF_SCHEMA_PATHS,
  verifyRemoteTakeoffSchema,
} from "./schema-fingerprint";

function openApiDocument(paths: readonly string[]): Record<string, unknown> {
  return {
    openapi: "3.0.0",
    info: { title: "PostgREST API", version: "14.1" },
    paths: Object.fromEntries(paths.map((path) => [path, { get: {} }])),
  };
}

describe("takeoff integration schema fingerprint", () => {
  it("includes the canonical automated-takeoff orchestration boundary", () => {
    for (const path of [
      "/takeoff_jobs",
      "/takeoff_job_units",
      "/takeoff_job_events",
      "/rpc/transition_takeoff_state",
    ]) {
      assert.ok(REQUIRED_TAKEOFF_SCHEMA_PATHS.includes(path as never), `missing schema fingerprint path ${path}`);
    }
  });

  it("accepts a Data API schema containing every takeoff table and RPC boundary", () => {
    assert.doesNotThrow(() =>
      assertTakeoffSchemaDocument(openApiDocument(REQUIRED_TAKEOFF_SCHEMA_PATHS)),
    );
  });

  it("rejects a reachable Supabase project whose OnyxIntel schema is missing", () => {
    assert.throws(
      () => assertTakeoffSchemaDocument(openApiDocument(["/projects", "/documents"])),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /integration test schema is not current/i);
        assert.match(error.message, /\/tenants/);
        assert.match(error.message, /\/rpc\/apply_vision_extraction_takeoff_items/);
        return true;
      },
    );
  });

  it("rejects a non-OpenAPI response instead of treating it as an empty valid schema", () => {
    assert.throws(
      () => assertTakeoffSchemaDocument({ message: "upstream unavailable" }),
      /did not return a PostgREST OpenAPI document/i,
    );
  });

  it("rejects an unreachable or unauthorized Data API before integration tests start", async () => {
    await assert.rejects(
      () => verifyRemoteTakeoffSchema({
        supabaseUrl: "https://test-ref.supabase.co",
        serviceKey: "test-secret",
        fetchImpl: async () => new Response("unauthorized", { status: 401 }),
      }),
      /could not read the isolated Supabase schema.*401/i,
    );
  });

  it("accepts the remote schema only after validating its OpenAPI paths", async () => {
    const result = await verifyRemoteTakeoffSchema({
      supabaseUrl: "https://test-ref.supabase.co/",
      serviceKey: "test-secret",
      fetchImpl: async () => Response.json(openApiDocument(REQUIRED_TAKEOFF_SCHEMA_PATHS)),
    });

    assert.deepEqual(result, {
      projectRef: "test-ref",
      checkedPathCount: REQUIRED_TAKEOFF_SCHEMA_PATHS.length,
    });
  });
});
