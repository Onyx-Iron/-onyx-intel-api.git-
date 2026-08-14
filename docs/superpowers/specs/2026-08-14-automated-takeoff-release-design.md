# OnyxIntel Automated Takeoff Release Design

Date: 2026-08-14  
Status: Approved design; implementation planning pending  
Related architecture: `2026-08-13-onyxintel-takeoff-agent-design.md`

## Objective

Make the non-manual OnyxIntel takeoff path dependable enough for paid production use across every construction trade. The release path covers source ingestion, document and sheet revision control, automated extraction, deterministic quantity validation, estimator review, approval, estimate transfer, recovery, authorization, and audit evidence.

“Flawless” is a release discipline, not a claim that AI cannot err. The application must prevent an AI error, stale revision, invalid unit, failed retry, or unauthorized action from silently becoming an approved financial quantity. The product will display the standing disclaimer that AI can make mistakes and requires qualified review.

## Scope

### Included

- Complete-estimate, selected-trade/division, bid-package, sheet/document, and alternate preflight.
- Native and scanned PDF ingestion, storage, splitting, OCR/vision extraction, progress, retry, and recovery.
- Existing supported vector/CAD/BIM extraction paths where deterministic fixtures prove correctness.
- Authoritative document manifest and sheet revision lineage.
- Automated quantity candidates for every trade, governed by versioned trade knowledge packs.
- Explicit scale, unit, geometry, formula, location, source, revision, confidence, assumptions, and exclusions.
- Four-state review lifecycle: `suggested -> reviewed -> approved | rejected`.
- Immutable approval previews and idempotent transfer into draft estimates.
- Tenant and project authorization, immutable audit evidence, operational telemetry, and recovery.
- Isolated live-database, integration, browser, security, load, and outage testing.

### Deferred

- Manual drawing and editing productivity: freehand measurement creation, vertex editing, layers, multi-select, copy/paste, undo/redo, restore, and keyboard workflow.
- Automatic approval of AI or inferred quantities.
- Certification of trade knowledge or source formats without passing evidence.
- Pricing improvements, except preserving the takeoff-to-estimate boundary.

Manual-canvas code already used as an internal calculation or rendering dependency may remain, but it is not part of this release's user-facing acceptance gate.

## Architectural Decision

Harden the existing production-integrated pipeline instead of creating a second takeoff system. Introduce one orchestrated state model and one command boundary over the current Next.js routes, Supabase transaction functions, storage, Edge/Railway workers, deterministic quantity libraries, review gates, and estimate-sync outbox.

The canonical job states are:

`uploaded -> validated -> split -> classified -> extracted -> quantity_validated -> review_ready -> approved -> estimate_imported`

Failure and control states are:

`blocked`, `conflicted`, `failed_retryable`, `failed_terminal`, `superseded`, and `cancelled`.

Transitions are server-controlled, append-only in history, and idempotent. A stage may expose partial verified results, but it cannot skip a prerequisite or manufacture completion.

## Components and Responsibilities

### 1. Scope preflight

Before expensive processing, require the user to select all-scope or specific trades/divisions, packages, sheets/documents, and alternates. Store the confirmed scope and estimate the processing extent. Extraction outside that immutable scope is excluded unless the user creates a new scope version.

### 2. Source and revision manifest

Every source records tenant, project, checksum, format, issuer, issue date, revision, discipline, package, upload/import actor, retrieval time, processing version, and supersession links. Sheet identity combines sheet number, title, discipline, title-block evidence, and content fingerprints.

The reconciler may propose matches, but an authoritative-revision change requires review. Duplicate sheet numbers, conflicting dates, ambiguous lineage, stale documents, and cross-package collisions enter `conflicted`. Affected quantities cannot be approved or imported until resolved.

### 3. Durable orchestration

Each document, page, model, or view is a checkpointed work unit with a stable idempotency key, attempt count, lease, heartbeat, last error, retry time, and pipeline version. Transient failures use bounded exponential backoff. Deterministic failures are quarantined. Completed work is reused only when the source checksum and relevant pipeline versions still match.

A scheduled worker re-drives pending and retryable jobs and estimate-sync outbox events. Opportunistic processing after a request remains an optimization, never the sole recovery mechanism. Dead-letter items generate visible operational alerts and repair actions.

### 4. Extraction adapters

Each source adapter returns a common evidence-candidate contract rather than writing approved takeoff rows.

- Native PDF: text, tables, vectors, paths, symbols, dimensions, schedules, and title blocks.
- Scanned PDF: controlled rendering, OCR with bounding boxes, and vision candidates.
- DXF and other currently supported model formats: entities, layers, blocks, units, geometry, and source locators.
- Unsupported, corrupt, encrypted, or unitless sources: preserve the original and diagnostics; block only affected conclusions.

Document text is untrusted content. It cannot modify prompts, permissions, processing scope, approval policy, or tool behavior.

### 5. Trade classification and coverage

Candidates map to CSI MasterFormat, UniFormat, custom cost codes, bid packages, and cross-division scopes. Each classification includes model/pipeline version, evidence locator, confidence, and trade-pack version.

An extraction capability is `certified` only for the trade, source type, quantity type, and conditions represented by passing fixtures. Unsupported combinations remain `provisional` or `blocked`; the UI never represents broad all-trade availability from a narrow test.

### 6. Deterministic quantity validation

AI and OCR may identify objects and geometry, but server-side functions own arithmetic. Each quantity stores:

- measured, calculated, allowed, or inferred classification;
- source document, sheet/model, revision, and precise locator;
- original geometry and coordinate system;
- verified scale or explicit model units;
- original unit, normalized unit, conversion formula, formula version, and rounding;
- waste or conversion factors, including bank/loose/compacted volume distinctions;
- quantity checksum, confidence, assumptions, exclusions, and validation results.

Missing or conflicting scale, dimensions, units, revisions, or geometry blocks the affected quantity. The system must never substitute a guessed scale.

### 7. Review and approval

Every AI-, OCR-, or inference-derived candidate begins as `suggested`. `Reviewed` means inspected, not approved. Only an authorized user can approve or reject.

Approval uses an immutable preview containing exact item versions, revision manifest version, quantities, units, formulas, warnings, estimate effects, payload hash, actor, and expiry. Any source, revision, quantity, permission, or item change invalidates the preview. Preparation, review, and material approval remain separable roles where configured.

### 8. Estimate transfer

Only approved candidates from authoritative, non-conflicted revisions may enter estimating. The import command:

1. verifies identity, tenant, project membership, permissions, preview, payload hash, and current source versions;
2. checks a server-generated idempotency key;
3. writes canonical takeoff, history, approval, and command-result evidence atomically;
4. targets an existing draft estimate or creates a new draft;
5. never mutates an approved estimate;
6. enqueues durable estimate synchronization;
7. re-reads and reconciles the committed result.

Repeated, concurrent, or ambiguous retries produce one financial result. Deleted or superseded sources create visible reconciliation exceptions rather than silently orphaning estimate rows.

### 9. Authorization and audit

Authentication derives from the active Clerk session. Tenant and project scope is verified server-side. The release requires real project membership/role enforcement for confidential reads, review, approval, and estimate transfer; tenant-wide financial permission alone is insufficient.

Audit evidence records actor, role, tenant, project, request, processing scope, source and pipeline versions, model/tool calls, calculations, assumptions, preview, confirmation, idempotency key, result, retries, errors, and correlation ID. Audit rows are append-only and cannot be altered by uploaded content.

### 10. User experience

The takeoff workspace must show:

- processing scope and estimated extent before starting;
- per-document and per-sheet state, progress, revision, and error details;
- coverage by trade and quantity type;
- measured versus inferred quantities;
- source-linked markups and confidence;
- conflicts, missing evidence, failed work, and retry actions;
- exact pending review and approval counts;
- estimate-transfer and reconciliation state;
- an always-available notice that AI can make mistakes and qualified review is required.

The interface must not show “complete” while any in-scope work is pending, failed, conflicted, stale, or blocked without an explicit accepted exclusion.

## Error and Recovery Rules

- Upload interruption: resume by content range/checksum without creating a second source.
- Split or extraction timeout: release the expired lease and retry the affected work unit only.
- Worker outage: preserve queued state and continue independent work.
- Stale revision: mark affected candidates stale and prevent approval/import.
- Re-extraction: retain approved/rejected decisions and historical output; replace only undecided candidates when safe.
- Estimate-sync failure: leave a durable retryable event, alert it, and reconcile before declaring completion.
- Ambiguous command outcome: inspect idempotency and committed rows before retrying.
- Cross-tenant or unauthorized project access: deny without revealing record existence or content.
- Prompt injection: classify as document content and record the attempted instruction without following it.

## Testing Strategy

### Environment integrity

Create a dedicated non-production Supabase test project or ephemeral database with every migration applied in order. Tests must fail fast when the expected schema/version is absent. Production credentials are forbidden in destructive integration tests.

### Automated coverage

- Unit and property tests for state transitions, hashes, scale, dimensional consistency, unit conversions, geometry, formulas, revision ordering, and conflict rules.
- Contract tests for every API, worker payload, state transition, and extraction adapter.
- Integration tests for atomicity, idempotency, concurrency, tenant/project isolation, project roles, immutable estimates, audit completeness, retries, outbox recovery, and stale-preview rejection.
- Browser tests for preflight, progress, conflict resolution, source-linked review, batch approval, error recovery, and estimate reconciliation.
- Security tests for prompt injection, malformed files, cross-tenant IDs, unauthorized project access, forged approvals, and duplicate writes.
- Load tests at 100, 500, and 1,000 sheets, plus representative large raster/vector pages and candidate volumes.
- Outage tests for storage, model provider, worker, database, and application interruptions.

### Golden trade fixtures

Maintain representative accepted quantities and tolerances for every active trade family and project type. A fixture records source revision, expected scope, quantities, units, exclusions, reviewer, and certification date. Automated extraction is certified only within the tested boundary.

Initial fixture families include architectural, structural, site/civil, utilities, landscaping, concrete, masonry, metals, wood, envelope, openings, finishes, specialties, equipment, furnishings, fire protection, plumbing, HVAC, electrical, communications, electronic safety/security, earthwork, transportation, waterway/marine, and process scopes.

## Release Gates

The automated takeoff path cannot be called production-ready until all of these are evidenced:

1. Unit, type, lint, and production build checks pass.
2. Takeoff integration tests pass against the isolated current schema with no skips or cancellations.
3. Browser tests pass for the complete automated workflow and recovery paths.
4. Cross-tenant and unauthorized project access tests pass.
5. No unapproved, stale, conflicted, unitless, or unsupported AI quantity can affect an estimate.
6. Approved estimates remain immutable and duplicate retries produce exactly one result.
7. Scheduled job and outbox recovery are deployed, observed, and alerting.
8. Revision lineage and stale-candidate invalidation are proven.
9. Golden fixtures publish actual accuracy, false-positive, false-negative, unit, and scope-completeness results per certified capability.
10. Load and outage tests meet documented service targets without silent loss or duplication.
11. Every remaining limitation is visible in-product and in the release evidence.

No claim of universal automated accuracy is permitted. The product may claim universal scope support while publishing certification status for each trade/source/quantity capability.

## Implementation Sequence

This design is one program delivered through bounded implementation milestones:

1. Test-environment integrity and executable release matrix.
2. Canonical state machine and durable retry/recovery.
3. Revision manifest, supersession, and stale-result invalidation.
4. Project membership and approval-preview enforcement.
5. Deterministic extraction contract and quantity provenance.
6. Estimate reconciliation and immutable import command.
7. Automated-workspace status, review, conflicts, and disclaimers.
8. Golden trade fixtures, browser/security/load/outage validation.
9. Release evidence, canary, monitoring, rollback, and certification report.

Each milestone must preserve existing capabilities, include migrations and rollback considerations, and pass its own targeted tests before the next begins.

## Success Criterion

An authorized estimator can select a project and processing scope, ingest a current plan set, monitor every work unit, resolve revision conflicts, review source-linked automated quantities, approve an immutable payload, and obtain exactly one reconciled draft-estimate result. Every material quantity is traceable, every uncertainty is visible, failures recover without silent loss, and AI output cannot bypass human or deterministic controls.
