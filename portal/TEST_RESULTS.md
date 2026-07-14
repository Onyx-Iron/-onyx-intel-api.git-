# Integration test environment log

Records which environment each live-database integration-test run actually
targeted. See [docs/frontend-backend-reconciliation/PRODUCTION_TEST_INCIDENT.md](docs/frontend-backend-reconciliation/PRODUCTION_TEST_INCIDENT.md)
for the incident this log exists to prevent a repeat of.

| Date | Suite(s) | Environment | Project ref | Notes |
|---|---|---|---|---|
| 2026-07-12 | procurement/workflow, project-controls/change-orders, project-controls/financial-redaction | **Production** (via `.env.local`) | `vvnigrbdsipriufhrwbs` | Mistake — see incident doc. Verified no residual data afterward. |
| 2026-07-13 | procurement/workflow (6/6), project-controls/change-orders (10/10), project-controls/financial-redaction (5/5) | Isolated Supabase branch `frontend-backend-reconciliation-test` | `wjngtkkezeytyymamlmm` | **21/21 passing.** Guard correctly resolved the branch (did not throw). Post-run verified zero residual rows across tenants/projects/project_profiles/estimate_items/invoices/change_order_items/marketplace_requests/vendor_bids/purchase_orders. |
| 2026-07-13 | procurement/workflow (6/6), project-controls/change-orders (10/10), project-controls/financial-redaction (5/5) | Isolated Supabase branch `frontend-backend-reconciliation-test` | `wjngtkkezeytyymamlmm` | Phase 5/6 final-verification re-run, after the Phase 4 route changes (procurement/requests, earthwork/volumes, invoices, lien-waivers project_id-optional) and the TypeScript/type-regeneration milestone. **21/21 passing**, same as prior run. Post-run query for `tenants` named like test/integration returned zero rows — confirmed no residual data. |

## Rule

Every future integration-test run that touches a live database must add a
row here — environment name + project ref (not the credential itself), not
just "ran ok". `lib/test-utils/integration-guard.ts` refuses to resolve a
production project ref, so a correctly-passing run in this log should never
be able to be production.
