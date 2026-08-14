# Automated Takeoff Release Evidence

**Evidence captured:** 2026-08-14T10:36:10Z  
**Branch:** `codex/upload-pipeline-reliability`  
**Tested implementation commit:** `fc97659493504e3fb98f133213e72d22843ad57d`  
**Release decision:** **NOT APPROVED** — software gates pass, but estimator-reviewed fixtures and canary runtime evidence are incomplete.

## Release gate matrix

| Gate | Current evidence | Environment | Result |
|---|---|---|---|
| Confirmed processing scope | Scope is allowlisted and stamped with the authenticated actor; uploaded instructions cannot alter authority. Unit and adversarial tests pass. | Local | Pass |
| Durable job state | Closed transitions, optimistic concurrency, events, and truthful incomplete/conflicted states pass. | Isolated Supabase `wjngtkkezeytyymamlmm` | Pass |
| Revision authority | Authoritative manifests, stale-candidate blocking, and conflict handling pass. | Unit + isolated Supabase | Pass |
| Quantity provenance | Python and TypeScript reproduce the same evidence checksum and independently recompute supported formulas. | Local + isolated Supabase | Pass |
| Human approval | Changed, expired, wrong-actor, stale, or unvalidated candidates cannot confirm. Browser acceptance covers locked and successful flows. | Local browser + isolated Supabase | Pass |
| Estimate import | Only confirmed previews enter a draft estimate; approved versions remain immutable; repeated sync is idempotent. | Isolated Supabase | Pass |
| Tenant/project isolation | Known cross-tenant identifiers return no record; approval preview requires active project membership. | Isolated Supabase | Pass |
| Retry and outage recovery | Concurrent recovery reclaims an expired unit once; terminal failures stay visible; restarted outbox workers do not repeat completed work. | Local + isolated Supabase | Pass |
| Deterministic load | 25,000 evidence validations at 244,821 ops/sec and 10,000 approval hashes at 209,303 ops/sec. HTTP/database/storage load is still pending canary. | Local | Partial |
| Capability certification | Machine report: 0 certified, 0 provisional, 6 blocked. No unreviewed capability is presented as authoritative. | `fixtures/takeoff/certification-report.json` | Blocked |
| Canary, telemetry, rollback | Production signed-out smoke checks pass. The tested branch has not completed native-PDF, scanned-PDF, forced-retry, import, telemetry, and rollback observations in a canary. | Production smoke only | Blocked |

## Exact verification results

- `python -m pytest test_takeoff_extract.py -q`: 7 passed.
- `npm run test:unit`: passed with no failures, cancellations, or skips counted as evidence.
- `npm run test:integration`: passed in full against isolated Supabase `wjngtkkezeytyymamlmm`; 40 required takeoff schema boundaries verified and no integration suite was skipped.
- `npm run test:browser`: all 4 governed Chromium scenarios passed, including the 2 automated-takeoff scenarios.
- `npm run evaluate:takeoff`: generated 0 certified, 0 provisional, and 6 blocked boundaries.
- `node tests/load/takeoff-load.mjs`: passed the local deterministic-service load threshold.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: production build passed and generated 116 application routes/pages.
- `npm run launch:smoke`: all public signed-out production checks passed.
- Paid AI routes are protected by an atomic database-backed limiter on isolated Supabase. Its allowance sequence verified as `true, true, false`; `anon` and `authenticated` cannot invoke the RPC, while `service_role` can.
- `npm run launch:audit`: correctly failed on four explicit gates: missing local `CRON_SECRET`, missing platform-administrator allowlist, incomplete Paddle configuration, and incomplete capability certification.

## Certification status and required evidence

The following exact capability boundaries are blocked: native PDF schedule counts, DXF length, DXF area, IFC model quantities, XLSX scheduled quantities, and scanned-PDF quantities. A boundary requires at least three source-checksummed fixtures, accepted expected quantities, a named qualified reviewer and qualification, effective date, complete metrics, recall of at least 95%, precision of at least 98%, 100% unit accuracy, scope completeness of at least 95%, and no quantity error above 2%.

The placeholder fixture records are intentionally empty and pending. They are a collection template, not evidence. They must be replaced with legally usable plan/model/schedule sets and accepted estimator or trade-contractor answers. AI-generated answers cannot serve as their own certification truth.

## Remaining launch blockers

1. Acquire and review the required golden source fixtures for every takeoff boundary intended for launch.
2. Run authenticated HTTP, worker, database, and storage load against an isolated preview deployment.
3. Deploy this exact tested revision to a canary with the isolated database and worker configuration.
4. Observe one native-PDF workflow, one scanned-PDF workflow, one forced retry and recovery, and one approved idempotent estimate import.
5. Verify telemetry, alerting, scheduled cron authentication, and rollback, then update this document with deployment URLs, timestamps, and artifacts.
6. Keep manual drawing/editing productivity outside the automated-takeoff release claim, as explicitly deferred.
