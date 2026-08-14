import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function withoutSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

describe("fresh-database migration ordering", () => {
  it("guards security changes for the optional Clerk FDW table", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260714_secure_clerk_fdw_table.sql"),
      "utf8",
    );

    assert.match(
      withoutSqlComments(migration),
      /to_regclass\s*\(\s*'public\."1"'\s*\)/i,
      "the Clerk FDW table may not exist on a fresh or non-Clerk database",
    );
  });

  it("allows service-role writes to execute private project-sync triggers", () => {
    const migration = withoutSqlComments(readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260813002000_project_sync_backbone.sql"),
      "utf8",
    ));

    assert.match(
      migration,
      /grant\s+usage\s+on\s+schema\s+private\s+to\s+service_role/i,
      "service_role needs private-schema USAGE for trigger functions invoked by app writes",
    );
    for (const functionName of [
      "append_project_change",
      "record_project_change",
      "record_document_child_change",
      "record_message_change",
    ]) {
      assert.match(
        migration,
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+private\\.${functionName}\\s*\\(`, "i"),
        `service_role needs EXECUTE on private.${functionName}`,
      );
    }
    assert.match(
      migration,
      /where\s+d\.id\s*=\s*nullif\(v_scope\s*->>\s*'document_id',\s*''\s*\)\s*;/i,
      "documents.id and child document_id are text; the sync trigger must not cast either side to uuid",
    );
  });

  it("does not mark deterministic row-version conflicts as retryable serialization failures", () => {
    const migration = withoutSqlComments(readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260814010000_takeoff_job_state.sql"),
      "utf8",
    ));
    assert.doesNotMatch(
      migration,
      /row version conflict[\s\S]{0,160}errcode\s*=\s*'40001'/i,
      "40001 causes the database gateway to retry a conflict that cannot succeed",
    );
  });

  it("defines current_tenant_id before the first policy references it", () => {
    const migrationsDir = resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    let definitionFile: string | undefined;
    let firstReferenceFile: string | undefined;

    for (const file of files) {
      const sql = withoutSqlComments(readFileSync(resolve(migrationsDir, file), "utf8"));
      const defines = /create\s+or\s+replace\s+function\s+public\.current_tenant_id\s*\(/i.test(sql);
      const references = /public\.current_tenant_id\s*\(/i.test(sql.replace(
        /create\s+or\s+replace\s+function\s+public\.current_tenant_id\s*\(/ig,
        "",
      ));
      if (defines && !definitionFile) definitionFile = file;
      if (references && !firstReferenceFile) firstReferenceFile = file;
    }

    assert.ok(definitionFile, "current_tenant_id must be defined by tracked migrations");
    assert.ok(firstReferenceFile, "at least one tracked policy should reference current_tenant_id");
    assert.ok(
      definitionFile.localeCompare(firstReferenceFile) <= 0,
      `current_tenant_id is first defined in ${definitionFile}, after its first reference in ${firstReferenceFile}`,
    );
  });

  for (const functionName of ["_set_updated_at", "set_updated_at", "match_chunks", "rls_auto_enable"]) {
    it(`defines ${functionName} before an earlier migration alters or revokes it`, () => {
      const migrationsDir = resolve(__dirname, "../../supabase/migrations");
      const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
      let definitionFile: string | undefined;
      let firstMutationFile: string | undefined;
      const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const definition = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\s*\\(`, "i");
      const mutation = new RegExp(`(?:alter|revoke[\\s\\S]{0,80})\\s+function\\s+public\\.${escapedName}\\s*\\(`, "i");

      for (const file of files) {
        const sql = withoutSqlComments(readFileSync(resolve(migrationsDir, file), "utf8"));
        if (definition.test(sql) && !definitionFile) definitionFile = file;
        if (mutation.test(sql) && !firstMutationFile) firstMutationFile = file;
      }

      assert.ok(definitionFile, `${functionName} must be defined by tracked migrations`);
      assert.ok(firstMutationFile, `${functionName} must have a tracked security/search-path mutation`);
      assert.ok(
        definitionFile.localeCompare(firstMutationFile) <= 0,
        `${functionName} is first defined in ${definitionFile}, after its first mutation in ${firstMutationFile}`,
      );
    });
  }
});
