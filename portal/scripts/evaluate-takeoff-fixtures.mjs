import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateCapability } from "../lib/takeoff/certification.ts";

const root = process.cwd();
const fixtureRoot = resolve(root, "fixtures", "takeoff");
const manifestPath = resolve(fixtureRoot, "manifest.json");
const reportPath = resolve(fixtureRoot, "certification-report.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function boundaryKey(boundary) {
  return `${boundary.tradeFamily}::${boundary.sourceType}::${boundary.quantityType}`;
}

function sourceIsVerified(fixture) {
  if (!fixture.sourceFile || !fixture.sourceChecksum) return false;
  const path = resolve(fixtureRoot, fixture.sourceFile);
  if (!existsSync(path)) return false;
  const declared = String(fixture.sourceChecksum).replace(/^sha256:/, "").toLowerCase();
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  return declared === actual;
}

function hasQualifiedReview(fixture) {
  const review = fixture.review ?? {};
  return review.status === "accepted"
    && typeof review.reviewer === "string" && review.reviewer.trim().length > 0
    && typeof review.qualification === "string" && review.qualification.trim().length > 0
    && typeof review.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(review.effectiveDate);
}

function loadItems(relativePath, fixtureId, label) {
  if (!relativePath) return null;
  const path = resolve(fixtureRoot, relativePath);
  if (!existsSync(path)) throw new Error(`${fixtureId}: ${label} file does not exist: ${relativePath}`);
  const document = readJson(path);
  if (document.fixtureId !== fixtureId || !Array.isArray(document.items)) {
    throw new Error(`${fixtureId}: ${label} file has an invalid fixture id or items collection`);
  }
  return document.items;
}

function evaluateItems(expectedItems, actualItems, tolerance) {
  if (!expectedItems?.length || !actualItems) return null;
  const expected = new Map(expectedItems.map((item) => [item.key, item]));
  const actual = new Map(actualItems.map((item) => [item.key, item]));
  const matched = [...expected.keys()].filter((key) => actual.has(key));
  const unitMatches = matched.filter((key) => expected.get(key).unit === actual.get(key).unit);
  const errors = matched.map((key) => {
    const expectedQuantity = Number(expected.get(key).quantity);
    const actualQuantity = Number(actual.get(key).quantity);
    if (!Number.isFinite(expectedQuantity) || !Number.isFinite(actualQuantity)) return Number.POSITIVE_INFINITY;
    if (expectedQuantity === 0) return actualQuantity === 0 ? 0 : Number.POSITIVE_INFINITY;
    return Math.abs(actualQuantity - expectedQuantity) / Math.abs(expectedQuantity);
  });
  const withinTolerance = errors.filter((error) => error <= tolerance).length;
  return {
    expected: expected.size,
    actual: actual.size,
    matched: matched.length,
    unitMatches: unitMatches.length,
    withinTolerance,
    maxQuantityError: errors.length ? Math.max(...errors) : Number.POSITIVE_INFINITY,
  };
}

const manifest = readJson(manifestPath);
if (manifest.schemaVersion !== "takeoff-golden-fixtures-v1") {
  throw new Error(`Unsupported takeoff fixture schema: ${manifest.schemaVersion ?? "missing"}`);
}
if (!Array.isArray(manifest.capabilities) || !Array.isArray(manifest.fixtures)) {
  throw new Error("Takeoff fixture manifest must contain capabilities and fixtures arrays");
}

const duplicateIds = manifest.fixtures
  .map((fixture) => fixture.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate fixture ids: ${[...new Set(duplicateIds)].join(", ")}`);

for (const fixture of manifest.fixtures) {
  loadItems(fixture.expectedFile, fixture.id, "expected");
}

const capabilities = manifest.capabilities.map((boundary) => {
  const fixtures = manifest.fixtures.filter((fixture) => boundaryKey(fixture.boundary) === boundaryKey(boundary));
  const reviewed = fixtures.filter(hasQualifiedReview);
  const verified = fixtures.filter(sourceIsVerified);
  const evaluations = fixtures.map((fixture) => {
    const expectedItems = loadItems(fixture.expectedFile, fixture.id, "expected");
    const actualItems = loadItems(fixture.actualFile, fixture.id, "actual");
    return evaluateItems(expectedItems, actualItems, Number(fixture.quantityTolerance ?? 0.02));
  }).filter(Boolean);

  const expectedCount = evaluations.reduce((sum, result) => sum + result.expected, 0);
  const actualCount = evaluations.reduce((sum, result) => sum + result.actual, 0);
  const matchedCount = evaluations.reduce((sum, result) => sum + result.matched, 0);
  const unitMatches = evaluations.reduce((sum, result) => sum + result.unitMatches, 0);
  const withinTolerance = evaluations.reduce((sum, result) => sum + result.withinTolerance, 0);
  const metrics = {
    fixtures: fixtures.length,
    reviewedFixtures: reviewed.length,
    verifiedSourceFixtures: verified.length,
    qualifiedReviewerFixtures: reviewed.length,
    boundary,
    recall: expectedCount ? matchedCount / expectedCount : undefined,
    precision: actualCount ? matchedCount / actualCount : undefined,
    unitAccuracy: matchedCount ? unitMatches / matchedCount : undefined,
    scopeCompleteness: expectedCount ? withinTolerance / expectedCount : undefined,
    maxQuantityError: evaluations.length ? Math.max(...evaluations.map((result) => result.maxQuantityError)) : undefined,
  };
  return {
    boundary,
    fixtureIds: fixtures.map((fixture) => fixture.id),
    metrics,
    certification: evaluateCapability(metrics),
  };
});

const statusCounts = capabilities.reduce((counts, capability) => {
  counts[capability.certification.status] += 1;
  return counts;
}, { certified: 0, provisional: 0, blocked: 0 });

const report = {
  schemaVersion: "takeoff-capability-report-v1",
  manifestVersion: manifest.schemaVersion,
  policy: manifest.certificationPolicy,
  summary: statusCounts,
  capabilities,
  notice: "Blocked and provisional capabilities are not authoritative. AI-assisted quantities require qualified human review and approval.",
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ report: reportPath, ...statusCounts }, null, 2));
