# Authorization Model — Takeoff Integrity Milestone

## The architectural risk this milestone does NOT fix

Per AUTHORIZATION_AUDIT.md's central finding: 91 of 121 API routes (including every route touched by this milestone) use `createServiceClient()`, which authenticates to Postgres as `service_role` and unconditionally bypasses RLS. This milestone does not attempt to change that — per Step 7's own instruction ("do not attempt an uncontrolled rewrite of all application data access in this milestone"). **Every guarantee described below is enforced in application code, not by the database.** This is documented, not hidden.

## Authorization model for every route changed in this milestone

| Route | Auth check | Tenant verification | Project verification | Permission check |
|---|---|---|---|---|
| `POST /api/takeoff/items` | Clerk `auth()`, 401 if absent | `tenantId` derived server-side from Clerk session, never from request body | **Added this milestone**: `assertProjectBelongsToTenant(project_id, tenantId)` before any insert | None (any tenant member can save manual takeoff) |
| `DELETE /api/takeoff/items` | Clerk `auth()` | Query scoped by server-derived `tenantId` AND client-supplied `project_id`/`id` together — a mismatched `project_id` simply matches zero rows | Implicit via the combined WHERE clause | None |
| `POST /api/takeoff/canvas/manual` | Clerk `auth()` | Server-derived `tenantId` | **Added this milestone**: `assertProjectBelongsToTenant` for every distinct `project_id` in the request | None |
| `POST /api/takeoff/canvas/utility`, `/api/earthwork/{pipe-runs,stockpiles,entrances}` | Clerk `auth()` | Server-derived `tenantId` | **Added this milestone**: `assertProjectBelongsToTenant` | None |
| `POST /api/takeoff/canvas/vision-extract` | Clerk `auth()` | Server-derived `tenantId` | `projectId` is resolved server-side via `page_id → document_id → documents.project_id` (never client-supplied at all for this route) | None |
| `PATCH /api/takeoff/items/[id]/review` | Clerk `auth()` | Server-derived `tenantId`; `id` is a path param, the row lookup is `.eq("id", id).eq("tenant_id", tenantId)` | Implicit (the item's own `project_id`, read from the DB row, not the request body) | **Added this milestone**: `assertPermission(tenantId, userId, "financial", "write")` — approving/rejecting affects estimate totals, so it uses the same "financial" write gate as procurement/PO approval and the estimate matrix |

## Why approval specifically requires a permission check

Step 4 requires: *"Approval requires an authenticated user with the correct tenant and project permission."* An authenticated session alone (any tenant member) was judged insufficient for an action that changes estimate totals — this mirrors the existing `financial` resource category in `lib/project-controls/permissions.ts`, already used to gate PO approval (`app/api/procurement/bids/[id]/approve/route.ts`) and the pricing matrix (`app/api/estimate/matrix/route.ts`). `ClientView` and `Subcontractor` roles cannot approve/reject a takeoff item; `Owner`/`Admin`/`Estimator`/`ProjectManager` can.

## Why the client cannot bypass these rules by changing request payloads

- `review_status` is never read from the client request body on `POST /api/takeoff/items` or `POST /api/takeoff/canvas/manual` — both routes set it to a hardcoded literal (`"approved"`) for genuinely new rows. There is no code path where a client-supplied `review_status` string reaches the database.
- `PATCH /api/takeoff/items/[id]/review` accepts only a fixed `action` enum (`"review"`\|`"approve"`\|`"reject"`), not an arbitrary status string — the server maps each enum value to its corresponding `review_status`, `reviewed_by`/`reviewed_at`/`approved_by`/`approved_at` fields.
- `tenantId` is derived exclusively from the Clerk session (`authTenantKey(userId, orgId)` → `getOrCreateTenant`), never accepted as a request parameter on any of these routes.

## Cross-tenant / cross-project denial — how it's proven

`takeoff-integrity.integration.test.ts` (live-database tests, see TEST_PLAN.md/ACCEPTANCE_RESULTS.md) proves:
- Cross-tenant read returns zero rows when queried with the wrong `tenant_id`.
- Cross-tenant update matches zero rows (and leaves the real row unchanged) when the WHERE clause's `tenant_id` doesn't match.
- Cross-tenant "approval" lookup (the exact query the review endpoint runs) finds nothing for a mismatched tenant.
- `assertProjectBelongsToTenant`-equivalent logic throws when a project genuinely belongs to a different tenant, and does not throw for the correct tenant.

These are the real isolation boundary today — not RLS. If a future route is added to this area of the app and forgets to call `assertProjectBelongsToTenant` or scope by `tenantId`, nothing at the database level will catch it. That risk is not new to this milestone; it's the pre-existing, documented architectural condition of the whole application (AUTHORIZATION_AUDIT.md D-01), and closing it properly is out of scope here per Step 7's explicit instruction.

## Remaining architectural risk (documented, not resolved)

Same as AUTHORIZATION_AUDIT.md's top finding: RLS policies exist on `takeoff_items` and `takeoff_item_history` and are correctly defined, but are not evaluated for any of this milestone's routes because they all use the service-role client. See REMAINING_RISKS.md.
