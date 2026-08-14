# OnyxIntel launch readiness

Updated: 2026-08-14

## Verified application state

- The project workspace uses the governed automated takeoff and versioned estimate workflows; legacy estimate mutation routes are disabled.
- Automated takeoff preserves source revision, geometry/text evidence, deterministic recomputation, immutable approvals, review state, and idempotent estimate import.
- Estimating separates markup from margin, saves versions atomically, rejects stale writes, requires approved price provenance, and supports governed price review.
- Reports, project management, procurement, financials, civil intelligence, preconstruction, documents, field operations, and administrative workspaces have real routes and persisted backends.
- Project synchronization, document processing status/retry, estimate migration, and project knowledge snapshots are wired into the application.
- AI-assisted output carries a persistent user disclaimer and does not become approved quantity or financial evidence without review.
- Operational-role bootstrap is least privilege: personal owners become `Owner`, Clerk organization admins become `Admin`, and unassigned organization members become `ClientView`.
- The isolated Supabase branch has zero security-advisor findings, zero unindexed foreign keys, zero duplicate indexes, and zero duplicate-policy warnings.
- Current working-tree checks pass: TypeScript, ESLint, unit tests, production build, and the four governed browser acceptance tests.
- `npm run launch` is fail-closed and includes type, lint, unit, isolated integration, browser, Python, takeoff certification, build, configuration audit, and live smoke checks.

## Release blockers

The product must not be represented as production-ready until every item below is evidenced:

- Supply reviewed golden takeoff fixtures for the six certification boundaries. Current certification is intentionally `0 certified / 6 blocked`; synthetic or unreviewed quantities cannot satisfy this gate.
- Configure and verify Paddle credentials, live price IDs, checkout, customer portal, webhook signature validation, and webhook replay for subscription creation, updates, past-due state, and cancellation.
- Confirm production Clerk keys, redirect URLs, organization roles, and at least one owner/admin/member authorization acceptance flow.
- Deploy this branch to a Vercel preview, run authenticated desktop/tablet/mobile workflow QA, and complete an actual document upload through storage, page splitting, extraction, review, approval, estimate import, and estimate approval.
- Verify Railway document/takeoff service configuration and outage recovery from the preview environment.
- Apply pending database migrations to production only after the isolated tests and preview canary pass. Production has not been migrated by this work.
- Complete legal/commercial launch requirements: Terms, Privacy, AI limitation language, refund/cancellation policy, support contact, tax setup, and production account ownership.

## Release sequence

1. Keep all development and database validation on the isolated branch.
2. Commit and push the reviewed integration branch.
3. Deploy a Vercel preview with production-shaped non-production credentials.
4. Run the complete launch gate and authenticated canary checklist.
5. Resolve every failed or missing evidence item; do not waive certification failures.
6. Back up production, apply reviewed migrations, deploy a controlled production canary, monitor, and roll back on any failed health or workflow check.
