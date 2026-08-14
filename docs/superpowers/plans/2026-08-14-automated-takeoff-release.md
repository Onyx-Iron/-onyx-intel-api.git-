# Automated Takeoff Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-usable automated takeoff workflow whose document, revision, quantity, approval, estimate, recovery, and authorization guarantees are proven against the current application and database.

**Architecture:** Harden the existing Next.js, Supabase, Railway/Edge worker, and deterministic takeoff services behind a canonical job state machine and command boundary. AI and OCR produce source-linked candidates; deterministic services validate arithmetic; authorized humans approve immutable previews; idempotent commands transfer approved quantities into draft estimates.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Clerk, Supabase Postgres/Storage/RPC, Deno Edge Functions, Railway Python workers, Node test runner with `tsx`, and browser verification.

## Global Constraints

- Manual drawing and editing productivity is deferred; do not expand freehand, vertex, layer, multi-select, undo/redo, copy/paste, or restore behavior.
- No AI-, OCR-, or inference-derived quantity may affect an estimate before explicit authorized approval.
- Never guess scale, units, source revision, tenant, project authority, or document intent.
- Approved estimates and historical source revisions remain immutable.
- Every consequential write is exact-previewed, idempotent, audited, and re-read after commit.
- Universal scope support is distinct from certification; only tested trade/source/quantity combinations may be labeled certified.
- Preserve unrelated dirty-worktree changes and stage only files belonging to the active task.

---

## Planned File Structure

- `portal/lib/test-utils/integration-guard.ts`: isolated-test environment and schema fingerprint gate.
- `portal/scripts/verify-test-schema.mjs`: migration/schema readiness check used before integration tests.
- `portal/lib/takeoff/job-state.ts`: canonical states and transition validation.
- `portal/lib/takeoff/contracts.ts`: shared job, work-unit, candidate, provenance, and command payload types.
- `portal/lib/takeoff/revisions.ts`: sheet identity, lineage, conflicts, and stale-candidate rules.
- `portal/lib/takeoff/quantity-validation.ts`: deterministic validation contract above existing geometry math.
- `portal/lib/takeoff/approval-preview.ts`: immutable preview hashing and expiry/staleness validation.
- `portal/lib/takeoff/import-command.ts`: idempotent approved-candidate import orchestration.
- `portal/lib/takeoff/certification.ts`: capability boundary and golden-fixture result aggregation.
- `portal/supabase/migrations/20260814*.sql`: additive orchestration, revision, membership, approval, command, and recovery schema.
- `portal/app/api/takeoff/jobs/**`: job creation, status, retry, and conflict-resolution APIs.
- `portal/app/api/takeoff/approval-preview/**`: preview creation and exact confirmation APIs.
- `portal/app/api/internal/takeoff/recover/route.ts`: authenticated scheduled recovery endpoint.
- `portal/components/takeoff/TakeoffTab.tsx`: automated workflow shell and truthful completion state.
- `portal/components/takeoff/ScopePreflight.tsx`: persisted immutable scope confirmation.
- `portal/components/takeoff/AutomatedTakeoffStatus.tsx`: progress, failures, revisions, coverage, and recovery UI.
- `portal/components/takeoff/AutomatedTakeoffReview.tsx`: source-linked review and approval preview UI.
- `portal/vercel.json`: scheduled recovery configuration when Vercel cron is the selected runtime.
- `portal/docs/release/automated-takeoff-evidence.md`: evidence matrix and certification results.

---

### Task 1: Isolated Integration-Test Environment and Schema Gate

**Files:**
- Modify: `portal/lib/test-utils/integration-guard.ts`
- Create: `portal/lib/test-utils/schema-fingerprint.ts`
- Create: `portal/lib/test-utils/schema-fingerprint.test.ts`
- Create: `portal/scripts/verify-test-schema.mjs`
- Modify: `portal/scripts/run-tests.mjs`
- Create: `portal/.env.test.local.example`
- Modify: `portal/package.json`

**Interfaces:**
- Produces: `assertIntegrationSchema(client): Promise<void>` and `npm run test:integration:takeoff`.
- Consumes: `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `ALLOW_INTEGRATION_TESTS=true`.

- [ ] **Step 1: Write failing schema-fingerprint tests**

```ts
test("rejects a database without the OnyxIntel migration fingerprint", async () => {
  await assert.rejects(() => assertIntegrationSchema(fakeClient({ tenants: false })), /test schema is not current/i);
});

test("accepts the complete takeoff schema", async () => {
  await assert.doesNotReject(() => assertIntegrationSchema(fakeClient({ tenants: true, takeoff_jobs: true })));
});
```

- [ ] **Step 2: Run the test and verify the missing implementation fails**

Run: `cd portal && npx tsx --test lib/test-utils/schema-fingerprint.test.ts`  
Expected: FAIL because `schema-fingerprint.ts` does not exist.

- [ ] **Step 3: Implement fail-fast environment and schema checks**

```ts
export async function assertIntegrationSchema(db: SupabaseClient): Promise<void> {
  const { data, error } = await db.rpc("onyx_test_schema_fingerprint");
  if (error || data !== EXPECTED_FINGERPRINT) {
    throw new Error("Integration test schema is not current; apply all migrations to the isolated test database");
  }
}
```

Make `run-tests.mjs integration` refuse production hostnames/keys, run the fingerprint before test discovery, and support a takeoff-only file filter. Document exact environment variable names without real secrets.

- [ ] **Step 4: Apply migrations to an isolated test database and run takeoff integration tests**

Run: `cd portal && npm run test:integration:takeoff`  
Expected: every takeoff/estimate integration test runs; no cancellation, schema-cache error, or silent skip.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add -- portal/lib/test-utils portal/scripts/verify-test-schema.mjs portal/scripts/run-tests.mjs portal/.env.test.local.example portal/package.json
git commit -m "test: require current isolated takeoff schema"
```

---

### Task 2: Canonical Takeoff Job State Machine

**Files:**
- Create: `portal/lib/takeoff/contracts.ts`
- Create: `portal/lib/takeoff/job-state.ts`
- Create: `portal/lib/takeoff/job-state.test.ts`
- Create: `portal/supabase/migrations/20260814010000_takeoff_job_state.sql`
- Create: `portal/app/api/takeoff/jobs/route.ts`
- Create: `portal/app/api/takeoff/jobs/[id]/route.ts`

**Interfaces:**
- Produces: `TakeoffJobState`, `TakeoffWorkUnitState`, `canTransition(from, to)`, and durable `takeoff_jobs`, `takeoff_job_units`, `takeoff_job_events` tables.
- Consumes: existing tenant/project ownership helpers and confirmed scope-preflight payload.

- [ ] **Step 1: Write failing transition and completion tests**

```ts
assert.equal(canTransition("uploaded", "validated"), true);
assert.equal(canTransition("uploaded", "approved"), false);
assert.equal(deriveJobCompletion([{ state: "extracted" }, { state: "conflicted" }]).complete, false);
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd portal && npx tsx --test lib/takeoff/job-state.test.ts`  
Expected: FAIL because the state module is absent.

- [ ] **Step 3: Implement closed transition maps and truthful completion**

```ts
export const allowedTransitions: Record<TakeoffJobState, readonly TakeoffJobState[]> = {
  uploaded: ["validated", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  validated: ["split", "classified", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  split: ["classified", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  classified: ["extracted", "blocked", "conflicted", "failed_retryable", "failed_terminal"],
  extracted: ["quantity_validated", "blocked", "conflicted", "failed_retryable", "failed_terminal"],
  quantity_validated: ["review_ready", "blocked", "conflicted"],
  review_ready: ["approved", "blocked", "conflicted", "superseded"],
  approved: ["estimate_imported", "superseded"],
  estimate_imported: ["superseded"],
  blocked: ["validated", "split", "classified", "extracted", "quantity_validated", "review_ready", "cancelled"],
  conflicted: ["quantity_validated", "review_ready", "superseded", "cancelled"],
  failed_retryable: ["validated", "split", "classified", "extracted", "cancelled"],
  failed_terminal: ["cancelled"],
  superseded: [],
  cancelled: [],
};
```

Persist transitions through one security-definer RPC that validates tenant/project, expected row version, and allowed transition, then appends an event in the same transaction.

- [ ] **Step 4: Test migration and APIs against the isolated database**

Run: `cd portal && npm run test:integration:takeoff`  
Expected: transition concurrency, invalid skips, cross-tenant denial, and event atomicity pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- portal/lib/takeoff/contracts.ts portal/lib/takeoff/job-state.ts portal/lib/takeoff/job-state.test.ts portal/supabase/migrations/20260814010000_takeoff_job_state.sql portal/app/api/takeoff/jobs
git commit -m "feat: add canonical takeoff job state"
```

---

### Task 3: Durable Retry, Lease Recovery, and Outbox Re-driver

**Files:**
- Create: `portal/lib/takeoff/recovery.ts`
- Create: `portal/lib/takeoff/recovery.test.ts`
- Create: `portal/lib/takeoff/recovery.integration.test.ts`
- Create: `portal/supabase/migrations/20260814020000_takeoff_recovery.sql`
- Create: `portal/app/api/internal/takeoff/recover/route.ts`
- Modify: `portal/lib/estimating/outbox-worker.ts`
- Modify: `portal/vercel.json`

**Interfaces:**
- Produces: `recoverTakeoffWork(options): Promise<RecoveryResult>` and authenticated scheduled endpoint.
- Consumes: job/work-unit leases from Task 2 and existing `processOutboxBatch`.

- [ ] **Step 1: Write failing backoff, lease, and dead-letter tests**

```ts
assert.equal(nextRetryAt(base, 1).getTime(), base.getTime() + 30_000);
assert.equal(nextRetryAt(base, 5).getTime(), base.getTime() + 480_000);
assert.equal(classifyAttempt({ attempts: 8, maxAttempts: 8 }), "failed_terminal");
```

- [ ] **Step 2: Prove tests fail before implementation**

Run: `cd portal && npx tsx --test lib/takeoff/recovery.test.ts`  
Expected: FAIL for missing recovery functions.

- [ ] **Step 3: Implement database claims and scheduled recovery**

Use `FOR UPDATE SKIP LOCKED`, expiring leases, bounded exponential backoff with jitter, maximum attempts, dead-letter state, and append-only attempt events. Require a timing-safe `TAKEOFF_RECOVERY_SECRET` for the internal route. Process both takeoff work and estimate-sync outbox rows in bounded batches.

- [ ] **Step 4: Run concurrent recovery and forced-outage integration tests**

Run: `cd portal && npx tsx --test lib/takeoff/recovery.integration.test.ts lib/estimating/outbox-worker.integration.test.ts`  
Expected: one worker owns each unit, expired work is reclaimed, retries do not duplicate, and terminal failures remain visible.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- portal/lib/takeoff/recovery.ts portal/lib/takeoff/recovery.test.ts portal/lib/takeoff/recovery.integration.test.ts portal/lib/estimating/outbox-worker.ts portal/supabase/migrations/20260814020000_takeoff_recovery.sql portal/app/api/internal/takeoff/recover/route.ts portal/vercel.json
git commit -m "feat: recover takeoff jobs and estimate sync"
```

---

### Task 4: Authoritative Sheet Revisions and Stale-Candidate Invalidation

**Files:**
- Create: `portal/lib/takeoff/revisions.ts`
- Create: `portal/lib/takeoff/revisions.test.ts`
- Create: `portal/lib/takeoff/revisions.integration.test.ts`
- Create: `portal/supabase/migrations/20260814030000_takeoff_revisions.sql`
- Modify: `portal/lib/documents/revisions.ts`
- Modify: `portal/app/api/takeoff/from-document/route.ts`
- Modify: `portal/app/api/takeoff/extract/route.ts`

**Interfaces:**
- Produces: `normalizeSheetIdentity`, `proposeRevisionLineage`, `isCandidateCurrent`, and durable manifest/lineage/conflict rows.
- Consumes: source checksums, existing document revision metadata, job IDs, and candidate source locators.

- [ ] **Step 1: Write failing revision conflict and staleness tests**

```ts
assert.equal(proposeRevisionLineage(oldA101, newA101).kind, "supersedes_proposed");
assert.equal(proposeRevisionLineage(a101Arch, a101Struct).kind, "conflict");
assert.equal(isCandidateCurrent(candidateRev1, authoritativeRev2), false);
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd portal && npx tsx --test lib/takeoff/revisions.test.ts`  
Expected: FAIL because revision reconciliation is not implemented.

- [ ] **Step 3: Implement manifest, lineage, conflict, and invalidation transactions**

Store immutable source versions and proposed/approved supersession. When authority changes, atomically mark dependent unapproved candidates stale; preserve approved history and create estimate reconciliation exceptions. Do not silently select among conflicting issue metadata.

- [ ] **Step 4: Run stale-revision and re-extraction integration tests**

Run: `cd portal && npx tsx --test lib/takeoff/revisions.integration.test.ts lib/estimating/takeoff-integrity.integration.test.ts`  
Expected: approved/rejected decisions survive, stale undecided candidates cannot approve, and history remains complete.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- portal/lib/takeoff/revisions.ts portal/lib/takeoff/revisions.test.ts portal/lib/takeoff/revisions.integration.test.ts portal/lib/documents/revisions.ts portal/app/api/takeoff/from-document/route.ts portal/app/api/takeoff/extract/route.ts portal/supabase/migrations/20260814030000_takeoff_revisions.sql
git commit -m "feat: enforce authoritative takeoff revisions"
```

---

### Task 5: Project Membership and Immutable Approval Previews

**Files:**
- Create: `portal/lib/takeoff/approval-preview.ts`
- Create: `portal/lib/takeoff/approval-preview.test.ts`
- Create: `portal/lib/takeoff/approval-preview.integration.test.ts`
- Create: `portal/supabase/migrations/20260814040000_project_membership_takeoff_approvals.sql`
- Modify: `portal/lib/project-controls/permissions.ts`
- Create: `portal/app/api/takeoff/approval-preview/route.ts`
- Create: `portal/app/api/takeoff/approval-preview/[id]/confirm/route.ts`
- Modify: `portal/app/api/takeoff/items/[id]/review/route.ts`

**Interfaces:**
- Produces: `buildApprovalPayload`, `hashApprovalPayload`, `validateApprovalPreview`, project memberships, preview rows, and confirmation records.
- Consumes: authoritative revision version from Task 4 and existing Clerk/tenant role checks.

- [ ] **Step 1: Write failing hash, expiry, mutation, and authorization tests**

```ts
assert.equal(hashApprovalPayload(payload), hashApprovalPayload(structuredClone(payload)));
assert.equal(validateApprovalPreview(preview, { now: afterExpiry }).valid, false);
assert.equal(validateApprovalPreview(preview, { candidateVersion: 9 }).reason, "candidate_changed");
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd portal && npx tsx --test lib/takeoff/approval-preview.test.ts`  
Expected: FAIL for missing preview logic.

- [ ] **Step 3: Implement project membership and exact confirmation**

Add tenant/project/user membership with explicit project role. Hash canonical JSON containing candidate IDs/versions, revision manifest version, units, quantities, formulas, warnings, and estimate effects. Approval confirmation must verify the exact authenticated actor, active project permission, expiry, payload hash, and unchanged source state.

- [ ] **Step 4: Run authorization and race integration tests**

Run: `cd portal && npx tsx --test lib/takeoff/approval-preview.integration.test.ts lib/estimating/takeoff-integrity.integration.test.ts`  
Expected: cross-tenant and unauthorized project actions are denied; changed or expired previews cannot approve.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- portal/lib/takeoff/approval-preview.ts portal/lib/takeoff/approval-preview.test.ts portal/lib/takeoff/approval-preview.integration.test.ts portal/lib/project-controls/permissions.ts portal/app/api/takeoff/approval-preview portal/app/api/takeoff/items/[id]/review/route.ts portal/supabase/migrations/20260814040000_project_membership_takeoff_approvals.sql
git commit -m "feat: gate takeoff approval by project and payload"
```

---

### Task 6: Deterministic Candidate and Quantity Provenance Contract

**Files:**
- Create: `portal/lib/takeoff/quantity-validation.ts`
- Create: `portal/lib/takeoff/quantity-validation.test.ts`
- Create: `portal/lib/takeoff/quantity-validation.integration.test.ts`
- Create: `portal/supabase/migrations/20260814050000_takeoff_candidate_provenance.sql`
- Modify: `portal/app/api/takeoff/canvas/vision-extract/route.ts`
- Modify: `portal/supabase/functions/page-takeoff-worker/index.ts`
- Modify: `takeoff_extract.py`
- Modify: `takeoff_validator.py`
- Test: `test_takeoff_extract.py`

**Interfaces:**
- Produces: `validateQuantityCandidate(input): QuantityValidationResult` with a versioned evidence contract.
- Consumes: source/revision IDs, geometry, explicit units/scale, trade-pack version, and extraction metadata.

- [ ] **Step 1: Write failing dimensional and provenance tests**

```ts
assert.equal(validateQuantityCandidate(unitlessLength).status, "blocked");
assert.equal(validateQuantityCandidate(staleRevision).reason, "stale_revision");
assert.equal(validateQuantityCandidate(validArea).formulaVersion, "area-v1");
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd portal && npx tsx --test lib/takeoff/quantity-validation.test.ts`  
Expected: FAIL because the shared validator is absent.

- [ ] **Step 3: Implement a single evidence-candidate contract across workers**

Require source locator, source checksum/revision, geometry coordinate system, original/normalized units, explicit scale or model units, measurement class, formula version, calculation inputs/result/checksum, trade classification/version, confidence, assumptions, and exclusions. Recompute deterministic arithmetic server-side and block incompatible dimensions or guessed scale.

- [ ] **Step 4: Run TypeScript/Python contract fixtures and integration tests**

Run: `cd portal && npx tsx --test lib/takeoff/quantity-validation.integration.test.ts && python -m pytest ../test_takeoff_extract.py -q`  
Expected: shared fixtures yield matching normalized quantities and checksums; invalid units/revisions are blocked.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- portal/lib/takeoff/quantity-validation.ts portal/lib/takeoff/quantity-validation.test.ts portal/lib/takeoff/quantity-validation.integration.test.ts portal/app/api/takeoff/canvas/vision-extract/route.ts portal/supabase/functions/page-takeoff-worker/index.ts portal/supabase/migrations/20260814050000_takeoff_candidate_provenance.sql takeoff_extract.py takeoff_validator.py test_takeoff_extract.py
git commit -m "feat: validate source-linked takeoff quantities"
```

---

### Task 7: Idempotent Estimate Import and Reconciliation

**Files:**
- Create: `portal/lib/takeoff/import-command.ts`
- Create: `portal/lib/takeoff/import-command.test.ts`
- Create: `portal/lib/takeoff/import-command.integration.test.ts`
- Create: `portal/supabase/migrations/20260814060000_takeoff_import_command.sql`
- Modify: `portal/app/api/estimate/import-takeoff/route.ts`
- Modify: `portal/lib/estimating/takeoff-import.ts`
- Modify: `portal/lib/estimating/outbox-worker.ts`

**Interfaces:**
- Produces: `executeApprovedTakeoffImport(command): Promise<ImportResult>` and durable reconciliation exceptions.
- Consumes: confirmed approval preview from Task 5 and validated candidates from Task 6.

- [ ] **Step 1: Write failing import safety tests**

```ts
assert.equal(await executeTwice(command).createdEstimateRows, 1);
assert.equal((await importIntoApprovedVersion(command)).targetVersion.status, "draft");
assert.equal((await importStaleCandidate(command)).error, "candidate_not_current");
```

- [ ] **Step 2: Verify failure before implementation**

Run: `cd portal && npx tsx --test lib/takeoff/import-command.test.ts`  
Expected: FAIL because the command service is absent.

- [ ] **Step 3: Implement one transactional command and reconciliation model**

Validate preview and permissions, lock source/candidate versions, check idempotency, write takeoff/history/approval/command-result evidence atomically, target only a draft estimate, enqueue sync, and re-read committed rows. Create explicit exceptions for deleted or superseded sources.

- [ ] **Step 4: Run concurrency, rollback, and immutable-estimate tests**

Run: `cd portal && npx tsx --test lib/takeoff/import-command.integration.test.ts lib/estimating/estimate-versioning.integration.test.ts lib/estimating/outbox-worker.integration.test.ts`  
Expected: concurrent calls produce one result, forced failure commits nothing partial, and approved versions do not change.

- [ ] **Step 5: Commit Task 7**

```powershell
git add -- portal/lib/takeoff/import-command.ts portal/lib/takeoff/import-command.test.ts portal/lib/takeoff/import-command.integration.test.ts portal/lib/estimating/takeoff-import.ts portal/lib/estimating/outbox-worker.ts portal/app/api/estimate/import-takeoff/route.ts portal/supabase/migrations/20260814060000_takeoff_import_command.sql
git commit -m "feat: import approved takeoffs exactly once"
```

---

### Task 8: Automated Takeoff Status and Review Workspace

**Files:**
- Create: `portal/components/takeoff/AutomatedTakeoffStatus.tsx`
- Create: `portal/components/takeoff/AutomatedTakeoffReview.tsx`
- Modify: `portal/components/takeoff/ScopePreflight.tsx`
- Modify: `portal/components/takeoff/TakeoffTab.tsx`
- Modify: `portal/app/dashboard/takeoff/page.tsx`
- Create: `portal/playwright.config.ts`
- Modify: `portal/package.json`
- Create: `portal/tests/browser/automated-takeoff.spec.ts`

**Interfaces:**
- Produces: truthful workflow UI from scope confirmation through reconciled estimate import.
- Consumes: job, revision, candidate, preview, and import APIs from Tasks 2–7.

- [ ] **Step 1: Write failing browser acceptance scenarios**

```ts
await expect(page.getByText("Processing scope")).toBeVisible();
await expect(page.getByText("Conflicted revision")).toBeVisible();
await expect(page.getByRole("button", { name: "Approve and import" })).toBeDisabled();
await expect(page.getByText(/AI can make mistakes/i)).toBeVisible();
```

- [ ] **Step 2: Run the browser test and confirm missing behavior**

Run: `cd portal && npm install --save-dev @playwright/test && npx playwright install chromium && npm run test:browser -- automated-takeoff.spec.ts`  
Expected: FAIL because the automated status/review workflow is incomplete.

- [ ] **Step 3: Implement status, coverage, conflict, review, and reconciliation UI**

Configure Playwright's web server to run the existing Next.js application and add `"test:browser": "playwright test"` to `package.json`. Show scope, per-document/sheet states, revision/conflict details, trade/quantity coverage, source-linked candidates, measured/inferred status, confidence, errors/retries, pending approval counts, immutable preview, estimate outcome, and the AI disclaimer. Completion must remain false for unresolved in-scope work unless an authorized exclusion is recorded.

- [ ] **Step 4: Run browser, accessibility, and production checks**

Run: `cd portal && npm run test:browser -- automated-takeoff.spec.ts && npm run typecheck && npm run lint && npm run build`  
Expected: all checks pass with no hidden controls or misleading completion state.

- [ ] **Step 5: Commit Task 8**

```powershell
git add -- portal/components/takeoff/AutomatedTakeoffStatus.tsx portal/components/takeoff/AutomatedTakeoffReview.tsx portal/components/takeoff/ScopePreflight.tsx portal/components/takeoff/TakeoffTab.tsx portal/app/dashboard/takeoff/page.tsx portal/playwright.config.ts portal/package.json portal/package-lock.json portal/tests/browser/automated-takeoff.spec.ts
git commit -m "feat: add automated takeoff review workspace"
```

---

### Task 9: Golden Trade Fixtures and Capability Certification

**Files:**
- Create: `portal/lib/takeoff/certification.ts`
- Create: `portal/lib/takeoff/certification.test.ts`
- Create: `portal/fixtures/takeoff/manifest.json`
- Create: `portal/fixtures/takeoff/expected/*.json`
- Create: `portal/scripts/evaluate-takeoff-fixtures.mjs`
- Modify: `portal/package.json`

**Interfaces:**
- Produces: `evaluateCapability(results): CapabilityCertification` and `npm run evaluate:takeoff`.
- Consumes: versioned source fixtures and accepted expected quantities reviewed by qualified estimators/trades.

- [ ] **Step 1: Write failing certification-boundary tests**

```ts
assert.equal(evaluateCapability({ fixtures: 0 }).status, "blocked");
assert.equal(evaluateCapability({ recall: 0.98, precision: 0.99, unitAccuracy: 1, scopeCompleteness: 0.97 }).status, "certified");
assert.equal(canClaimCertified(otherSourceType, certification), false);
```

- [ ] **Step 2: Verify tests fail**

Run: `cd portal && npx tsx --test lib/takeoff/certification.test.ts`  
Expected: FAIL because certification aggregation is absent.

- [ ] **Step 3: Implement fixture manifest and narrow certification reporting**

Record project type, trade family, source type, quantity type, conditions, revision, expected quantities/units, tolerances, reviewer, effective date, and source checksum. Compute precision, recall, quantity error, unit accuracy, and scope completeness. Never extend a certification beyond its exact fixture boundary.

- [ ] **Step 4: Run the evaluation and preserve actual results**

Run: `cd portal && npm run evaluate:takeoff`  
Expected: a machine-readable report listing certified, provisional, and blocked capabilities; missing trade fixtures are blocked rather than fabricated.

- [ ] **Step 5: Commit Task 9**

```powershell
git add -- portal/lib/takeoff/certification.ts portal/lib/takeoff/certification.test.ts portal/fixtures/takeoff portal/scripts/evaluate-takeoff-fixtures.mjs portal/package.json
git commit -m "test: certify automated takeoff capabilities"
```

---

### Task 10: Security, Load, Outage, Canary, and Release Evidence

**Files:**
- Create: `portal/tests/security/takeoff-adversarial.test.ts`
- Create: `portal/tests/load/takeoff-load.mjs`
- Create: `portal/tests/outage/takeoff-recovery.test.ts`
- Create: `portal/docs/release/automated-takeoff-evidence.md`
- Modify: `portal/scripts/launch-audit.mjs`
- Modify: `portal/scripts/launch-smoke.mjs`

**Interfaces:**
- Produces: signed release evidence mapping every design gate to current command output, runtime observation, or explicit failed gate.
- Consumes: all prior tasks, deployment preview, isolated test database, and configured worker runtimes.

- [ ] **Step 1: Write adversarial and outage cases before release execution**

```ts
test("uploaded prompt injection cannot change scope or authorization", scenario.promptInjection);
test("cross-tenant candidate id reveals no record", scenario.crossTenantCandidate);
test("ambiguous import response resolves through idempotency lookup", scenario.ambiguousImport);
test("worker outage resumes without duplicate candidates", scenario.workerRestart);
```

- [ ] **Step 2: Run the new suites and record baseline failures**

Run: `cd portal && npx tsx --test tests/security/takeoff-adversarial.test.ts tests/outage/takeoff-recovery.test.ts`  
Expected: any uncovered gate fails explicitly; no scenario is skipped.

- [ ] **Step 3: Fix only defects exposed by release tests and add regression coverage**

For each failure, add a focused regression assertion beside the responsible module, implement the smallest correction consistent with the design, and rerun the focused test before continuing.

- [ ] **Step 4: Execute the complete release matrix**

Run: `cd portal && npm run test:unit && npm run test:integration:takeoff && npm run test:browser -- automated-takeoff.spec.ts && npm run evaluate:takeoff && node tests/load/takeoff-load.mjs && npm run typecheck && npm run lint && npm run build && npm run launch:audit && npm run launch:smoke`  
Expected: every mandatory check passes; certification output retains provisional/blocked labels where evidence is insufficient.

- [ ] **Step 5: Deploy a canary and verify telemetry and rollback**

Deploy the tested commit to the preview/canary environment, run one native-PDF and one scanned-PDF workflow, force one retryable failure, confirm scheduled recovery and alerting, verify one approved import, and exercise the documented rollback without touching production financial records.

- [ ] **Step 6: Write evidence and commit Task 10**

The evidence document must map all eleven release gates to exact commit, migration, test command, result, environment, timestamp, artifact, remaining limitations, and approval state.

```powershell
git add -- portal/tests/security portal/tests/load portal/tests/outage portal/docs/release/automated-takeoff-evidence.md portal/scripts/launch-audit.mjs portal/scripts/launch-smoke.mjs
git commit -m "test: prove automated takeoff release gates"
```

---

## Final Completion Audit

- [ ] Re-read `docs/superpowers/specs/2026-08-14-automated-takeoff-release-design.md` requirement by requirement.
- [ ] Confirm each included requirement maps to current code plus passing evidence.
- [ ] Confirm every deferred manual-tool item remains outside release claims.
- [ ] Confirm no skipped/cancelled integration or browser test is counted as evidence.
- [ ] Confirm production and isolated-test database migration histories match the tested application commit.
- [ ] Confirm all unresolved capabilities are labeled provisional or blocked in the product and evidence report.
- [ ] Confirm rollback, audit correlation, scheduled recovery, and duplicate-write prevention through runtime observation.
- [ ] Only then declare the automated takeoff release complete.
