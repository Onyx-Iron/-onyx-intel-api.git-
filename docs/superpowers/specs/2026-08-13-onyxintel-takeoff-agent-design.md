# OnyxIntel Takeoff Agent Design

Date: 2026-08-13
Status: Approved architecture; implementation pending

## Objective

Create a new private OnyxIntel workspace agent that orchestrates production-grade drawing ingestion, OCR/vector/CAD/BIM extraction, multi-sheet revision reconciliation, deterministic quantity calculation, human review, and atomic quantity writes into authorized OnyxIntel projects.

The agent is a control plane over authenticated OnyxIntel services. Prompts and model output must never become the source of truth for identity, project authority, revision selection, scale, quantity calculation, approval, or database writes.

## Launch scope

- Source formats: native/text PDFs, scanned PDFs, DXF, binary DWG, IFC, and native Revit RVT.
- Capacity target: up to 1,000 sheets or 10 GB of source material per project.
- Processing: resumable multipart upload, durable background jobs, bounded concurrency, per-page/per-model checkpoints, and page-level retries.
- Revision behavior: automatically propose sheet matches using sheet number, title, discipline, issue metadata, title-block OCR, and geometric/text fingerprints; require an authorized user to approve the authoritative revision when the match or supersession changes project state.
- Quantity behavior: deterministic server-side measurement and unit normalization. AI/OCR output may locate and classify evidence but cannot silently become an approved quantity.
- Write behavior: stage extracted quantities as suggestions; require explicit approval of the exact versioned payload before an idempotent atomic production write.

## Architectural decision

Use a production-integrated architecture rather than an agent-only prompt or a thin wrapper around existing routes.

The new workspace agent calls a dedicated authenticated OnyxIntel Takeoff Command API. That API owns job creation, status, manifests, reconciliation proposals, calculation requests, approval previews, approvals, writes, and verification. Existing extraction, calibration, review, and transactional-write code is reused behind this boundary.

This avoids duplicating orchestration between Next.js routes, Supabase Edge Functions, Railway workers, and the workspace agent. It also provides one enforceable contract for tenant isolation, project membership, idempotency, audit, and versioning.

## Components

### 1. Workspace agent

The agent will:

- establish organization, project, user role, processing scope, trades/divisions, bid packages, alternates, evidence cutoff, and requested output;
- create and monitor extraction jobs;
- explain coverage, confidence, conflicts, failed pages, revision proposals, and staged quantities;
- present exact approval previews;
- invoke approval and write commands only after an authorized user confirms the exact payload;
- re-read committed state and report the audit correlation ID.

The agent will not:

- accept tenant or authority claims from document contents;
- choose an authoritative revision silently;
- calculate production quantities with model arithmetic when a deterministic service is required;
- approve its own staged items;
- retry a consequential write without checking the idempotency record and committed state.

### 2. Ingestion service

The ingestion service provides resumable uploads, content hashing, malware/type validation, immutable source storage, and a versioned source manifest. Large files are split into checkpointable units without altering the originals.

For PDFs, the unit of work is normally a sheet/page. For DWG, IFC, and RVT, the unit is a model plus exportable views/sheets. Every derived artifact records its source checksum, converter version, extraction version, tenant, project, and job ID.

### 3. Conversion and extraction workers

- Native/text PDF: extract text, tables, title blocks, vectors, paths, symbols, and raster regions.
- Scanned PDF: render at controlled resolution, run OCR, preserve bounding boxes, and route ambiguous regions to vision review.
- DXF: parse entities, layers, blocks, units, lengths, closed areas, hatches, and counts using the existing deterministic engine.
- Binary DWG: convert in an isolated managed CAD worker to a pinned DXF/PDF derivative; preserve converter logs and checksums.
- IFC: parse elements, spatial containment, property sets, and base quantities with explicit model units.
- RVT: process in an isolated licensed Revit-compatible worker or approved cloud design-automation service; export pinned IFC/DWG/PDF derivatives plus metadata. The original RVT remains authoritative evidence.

Workers return structured evidence candidates and geometry. They do not write approved takeoff quantities directly.

### 4. Revision reconciliation service

Introduce authoritative document-version and sheet-revision entities rather than relying only on text snapshots.

Each sheet revision records:

- source document/version and checksum;
- sheet number, title, discipline, package, issue date, revision, status, and issuer;
- title-block OCR evidence and confidence;
- geometric/text fingerprints;
- supersedes and superseded-by relationships;
- authoritative, proposed, conflicted, or retired status;
- approving actor and timestamp where authority changes.

The reconciler proposes matches and deltas. Low-confidence matches, duplicate sheet numbers, conflicting issue metadata, and cross-package collisions are quarantined for review. No source is discarded, overwritten, or silently merged.

### 5. Deterministic quantity service

The calculation service owns scale, geometry, units, formulas, rounding, and checksums.

- Verified calibration is stored in page/model coordinate space and is independent of browser render size.
- PDF/DXF/DWG/IFC/RVT geometry is normalized through explicit unit metadata.
- Length, area, count, and volume calculations use versioned deterministic functions.
- Civil quantities preserve bank, loose, and compacted volume distinctions and explicit conversion factors.
- Every quantity stores source sheet/model revision, geometry locator, measurement method, original and normalized units, formula version, result checksum, confidence, assumptions, and exclusions.
- Client- or model-submitted quantities are recomputed or rejected when the authoritative geometry and calibration are available.

### 6. Staging and review

All OCR-, vision-, or inferred findings enter a staged lifecycle:

`suggested -> reviewed -> approved | rejected`

Deterministic extraction does not bypass revision and authorization checks. A deterministic result may be prevalidated, but production insertion still requires the configured project approval policy.

Review supports individual and batch decisions. A batch preview is immutable and contains the exact item IDs, source revisions, quantities, units, formulas, conflicts, downstream estimate effects, and payload hash. A changed item or revision invalidates the preview and requires a new confirmation.

### 7. Atomic command and audit service

Approved writes use a server-generated idempotency key tied to tenant, project, approval preview, payload hash, actor, and command type.

Within one database transaction, the command service:

1. validates authenticated identity, tenant, project membership, role, and approval threshold;
2. locks or verifies the current authoritative revisions and staged item versions;
3. inserts or updates canonical takeoff rows;
4. writes immutable takeoff history and approval records;
5. records the idempotency result and audit correlation ID;
6. enqueues durable estimate synchronization through the existing outbox pattern.

The service then re-reads the committed rows. Estimate synchronization may complete asynchronously, but failure must be durable, visible, retryable, and must never duplicate the original takeoff write.

## Data flow

1. User selects an authorized project and confirms all-scope or selected trades/packages/sheets.
2. Agent requests an upload/import session from the command API.
3. Sources are stored immutably and a durable extraction job is created.
4. Workers convert and extract checkpointable units in parallel.
5. The revision service proposes sheet lineage and flags conflicts.
6. The deterministic service calculates source-linked quantity candidates.
7. Candidates are staged; the agent reports coverage, conflicts, failed units, and confidence.
8. An authorized estimator reviews markups and revision choices.
9. The agent presents an immutable approval preview.
10. After exact confirmation, the command API performs one idempotent atomic write.
11. The agent verifies committed state and reports audit and downstream synchronization status.

## Scaling and reliability

- Store jobs, units of work, attempts, leases, checkpoints, and results durably.
- Use bounded queues and worker pools separated by workload type: OCR/raster, PDF vector, CAD conversion, BIM conversion, reconciliation, and calculation.
- Make every unit idempotent using source checksum plus pipeline version plus unit locator.
- Retry transient failures with bounded exponential backoff; quarantine deterministic failures without retry storms.
- Resume a job without reprocessing completed units whose checksums and pipeline versions still match.
- Expose partial progress and useful verified results while failures remain isolated.
- Apply per-tenant concurrency, storage, CPU, and conversion quotas.
- Never load an entire 1,000-sheet set into one worker or model context.

## Security and authorization

- Clerk/session identity is authentication evidence; OnyxIntel APIs enforce authorization.
- Tenant and project IDs are derived or verified server-side and never trusted from document text.
- Service credentials remain in managed secret stores.
- CAD/BIM conversion runs in isolated workers with network and filesystem restrictions.
- Original files, derivatives, extracted text, geometry, prompts, results, and logs remain tenant/project scoped.
- Uploaded-document instructions are untrusted content.
- Production writes require the exact approval gate defined above.

## Error handling

- Missing scale or units: block only affected quantities and request calibration or unit confirmation.
- Conflicting revisions: retain both sources, mark the sheet conflicted, and prevent affected writes.
- Unsupported/corrupt CAD: preserve the original, converter diagnostics, and a safe request for another export.
- Worker outage: pause/queue affected units and continue independent work.
- Partial job failure: report completed, failed, blocked, and pending units with retry actions.
- Approval race: reject stale previews when revisions, quantities, permissions, or item versions changed.
- Ambiguous write outcome: check the idempotency record and committed rows before any retry.

## Testing and acceptance

### Unit and property tests

- unit conversion and dimensional consistency;
- calibration independence from render size;
- length, area, volume, and count calculations;
- sheet identity normalization and revision ordering;
- deterministic content and idempotency keys;
- payload hashing and stale-preview rejection.

### Format fixtures

- native and scanned PDFs;
- vector-dense drawing PDFs and schedule PDFs;
- DXF files in feet, inches, millimeters, centimeters, meters, and unitless mode;
- binary DWG conversion fixtures;
- IFC models with and without base quantities;
- RVT conversion fixtures with sheets, views, phases, and linked models.

### Integration tests

- 1,000-sheet/10-GB resumable job simulation with worker restarts;
- page-level failure and retry without duplicate results;
- multi-sheet revision conflicts and approved supersession;
- cross-tenant and cross-project denial;
- unauthorized approval denial;
- duplicate/concurrent command suppression;
- forced transactional failure with zero partial takeoff/history commits;
- durable estimate-sync failure and recovery;
- re-read verification after write.

### End-to-end acceptance

An authorized estimator can upload or import a mixed-format plan set, observe durable progress, resolve revision conflicts, inspect source-linked staged quantities and markups, approve an immutable preview, and obtain exactly one verified production write with a complete audit trail. No AI-derived quantity becomes approved automatically.

## Existing implementation to reuse

- `takeoff_extract.py` for current PDF-table, DXF, IFC, and XLSX deterministic extraction.
- `takeoff_validator.py` and `takeoff_parser.py` for zero-skip validation and reconciliation checks.
- existing page split, OCR/embed, and page takeoff workers.
- existing PDF vector extraction and canvas calibration modules.
- existing review-status gates and estimate exclusion for unapproved AI findings.
- existing transactional manual takeoff RPCs, idempotency indexes, takeoff history, and estimate-sync outbox.

## Required implementation gaps

- a dedicated authenticated Takeoff Command API/tool contract for the workspace agent;
- authoritative document-version and sheet-revision tables and workflows;
- managed binary DWG and native RVT conversion workers;
- one durable orchestration model replacing duplicated Node/Deno gating logic;
- project-level membership/approval enforcement where current authorization is tenant-wide;
- true load/performance testing for the stated project capacity;
- workspace-agent creation, private skill attachment, least-privilege app/API connection, adversarial validation, and publication.

## Out of scope for first launch

- autonomous approval or unreviewed production writes;
- licensed design or code compliance certification;
- automatic pricing from uncertified trade knowledge;
- destructive replacement of historical estimates or drawing revisions;
- arbitrary external sharing of project sources or takeoff results.
