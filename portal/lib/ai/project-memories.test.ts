import assert from "node:assert/strict";
import { formatMemoriesBlock, isFinancialMemoryFact, memoriesForFinancialAccess, normalizeFact } from "./project-memories";

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

function testFinancialMemoryRedaction() {
  assert.equal(isFinancialMemoryFact("Budget meeting is Thursday"), false);
  assert.equal(isFinancialMemoryFact("Project budget is $2,500,000"), true);
  assert.equal(isFinancialMemoryFact("Budget is 2500000"), true);
  const rows = [
    {
      id: "1",
      project_id: "p",
      tenant_id: "t",
      fact: "GC is Onyx & Iron",
      source_document_id: null,
      source_page: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "2",
      project_id: "p",
      tenant_id: "t",
      fact: "Project budget is $2,500,000",
      source_document_id: null,
      source_page: null,
      created_at: new Date().toISOString(),
    },
  ];
  assert.equal(memoriesForFinancialAccess(rows, false).length, 1);
  assert.equal(memoriesForFinancialAccess(rows, true).length, 2);
}

testNormalizeFact();
testFormatMemoriesBlock();
testFinancialMemoryRedaction();
console.log("project-memories.test.ts: ok");
