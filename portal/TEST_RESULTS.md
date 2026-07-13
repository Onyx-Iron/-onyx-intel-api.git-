# Integration test environment log

Records which environment each live-database integration-test run actually
targeted. See [docs/frontend-backend-reconciliation/PRODUCTION_TEST_INCIDENT.md](docs/frontend-backend-reconciliation/PRODUCTION_TEST_INCIDENT.md)
for the incident this log exists to prevent a repeat of.

| Date | Suite(s) | Environment | Project ref | Notes |
|---|---|---|---|---|
| 2026-07-12 | procurement/workflow, project-controls/change-orders, project-controls/financial-redaction | **Production** (via `.env.local`) | `vvnigrbdsipriufhrwbs` | Mistake — see incident doc. Verified no residual data afterward. |
| _pending_ | same three suites | Isolated Supabase branch (pending creation/approval) | _pending_ | Re-run planned once `.env.test.local` points at the isolated branch. |

## Rule

Every future integration-test run that touches a live database must add a
row here — environment name + project ref (not the credential itself), not
just "ran ok". `lib/test-utils/integration-guard.ts` refuses to resolve a
production project ref, so a correctly-passing run in this log should never
be able to be production.
