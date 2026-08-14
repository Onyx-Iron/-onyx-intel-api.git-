import { performance } from "node:perf_hooks";

import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import {
  computeExtractorEvidenceChecksum,
  validateExtractorQuantityCandidate,
  type ExtractorQuantityEvidence,
} from "@/lib/takeoff/quantity-validation";

const validationIterations = 25_000;
const hashingIterations = 10_000;
const evidenceWithoutChecksum: Omit<ExtractorQuantityEvidence, "calculation_checksum"> = {
  measurement_class: "length",
  source_kind: "geometry",
  original_unit: "FT",
  normalized_unit: "LF",
  formula_version: "geometry-length-v1",
  calculation_inputs: { raw_length: "125.5", conversion_factor: "1" },
  calculation_result: 125.5,
  source_quote: "DXF polyline length 125.5 FT",
  source_locator: "layer=C-UTIL;entity=42",
};
const evidence: ExtractorQuantityEvidence = {
  ...evidenceWithoutChecksum,
  calculation_checksum: computeExtractorEvidenceChecksum(evidenceWithoutChecksum),
};

const validationStarted = performance.now();
for (let index = 0; index < validationIterations; index += 1) {
  const result = validateExtractorQuantityCandidate(evidence, 125.5, "LF");
  if (result.status !== "validated") throw new Error(`Validation failed at iteration ${index}: ${result.reason}`);
}
const validationMs = performance.now() - validationStarted;

const hashingStarted = performance.now();
for (let index = 0; index < hashingIterations; index += 1) {
  const digest = hashApprovalPayload({
    jobId: "job-load",
    projectId: "project-load",
    candidateVersions: [{ id: `candidate-${index % 250}`, version: index % 10, quantity: 125.5, unit: "LF" }],
  });
  if (digest.length !== 64) throw new Error(`Invalid approval digest at iteration ${index}`);
}
const hashingMs = performance.now() - hashingStarted;

const result = {
  workload: "deterministic_takeoff_domain_services",
  validation: {
    operations: validationIterations,
    elapsedMs: Number(validationMs.toFixed(2)),
    operationsPerSecond: Math.round(validationIterations / (validationMs / 1000)),
  },
  approvalHashing: {
    operations: hashingIterations,
    elapsedMs: Number(hashingMs.toFixed(2)),
    operationsPerSecond: Math.round(hashingIterations / (hashingMs / 1000)),
  },
  limitations: "This is a local domain-service load gate. HTTP, worker, database, and storage load require the isolated canary environment.",
};

if (validationMs > 15_000 || hashingMs > 15_000) {
  console.error(JSON.stringify(result, null, 2));
  throw new Error("Takeoff deterministic load gate exceeded 15 seconds");
}
console.log(JSON.stringify(result, null, 2));
