import assert from "node:assert/strict";
import { formatMemoriesBlock, normalizeFact } from "./project-memories";

function testNormalizeFact() {
  assert.equal(normalizeFact("  Owner is  Acme  "), "Owner is Acme");
  assert.equal(normalizeFact("\nBudget: $2M\n"), "Budget: $2M");
}

function testFormatMemoriesBlock() {
  assert.equal(formatMemoriesBlock([]), "");
  const block = formatMemoriesBlock([
    {
      id: "1",
      project_id: "p",
      tenant_id: "t",
      fact: "GC is Onyx & Iron",
      source_document_id: null,
      source_page: null,
      created_at: new Date().toISOString(),
    },
  ]);
  assert.match(block, /Project Memory/);
  assert.match(block, /GC is Onyx & Iron/);
}

testNormalizeFact();
testFormatMemoriesBlock();
console.log("project-memories.test.ts: ok");
