# Authorization Audit

## 1. Clerk integration and tenant mapping

No `middleware.ts` exists — Clerk gating is centralized in `portal/proxy.ts` via `clerkMiddleware()` + `createRouteMatcher()` for public routes (`/`, `/sign-in(.*)`, `/sign-up(.*)`, Google OAuth callback, `/public/bids(.*)`, `/api/public/(.*)`, `/api/procurement/bids`), then `auth.protect()` for everything else. Sign-in/sign-up use prebuilt Clerk components (`portal/app/sign-in`, `portal/app/sign-up`).

Tenant resolution (`portal/lib/project-controls/server.ts`):
- `authTenantKey(userId, orgId)` → `orgId ?? "user_${userId}"` (Clerk org users get the real org as tenant key; personal-workspace users get a synthetic per-user key)
- `getOrCreateTenant(orgId, orgName)` → looks up `tenants` by `clerk_org_id`, creates if absent, auto-seeds starter cost catalog (best-effort, errors swallowed)
- `assertProjectBelongsToTenant` → verifies a client-supplied `project_id` actually belongs to the caller's tenant before allowing an insert referencing it

Usage pattern: 115 of 121 route.ts files call `auth()` and check `if (!userId) return 401` before proceeding; ~105 then call `getOrCreateTenant(authTenantKey(...))`.

## 2. Role/membership-based access control — real, but inconsistently wired

Two independent mechanisms exist:

- **Clerk org roles** (`org:admin`/`org:member`) — enforced server-side in `app/api/team/invite/route.ts` and `app/api/team/members/route.ts` (DELETE), both checking `callerMembership.role === "org:admin"` before proceeding.
- **App-level operational roles** — `project_profiles` table (`tenant_id`, `clerk_user_id`, `role`), roles `Owner/Admin/Estimator/ProjectManager/FieldSuperintendent/Subcontractor/ClientView`, gated via `lib/project-controls/permissions.ts`'s `assertPermission()`/`canPerform()` against a `WRITE_MATRIX` for `financial`/`field`/`admin` categories. `getUserRole` defaults to `"Estimator"` if no profile row exists.

**Gap:** `assertPermission`/`canPerform` are only actually called in **4 route files**: `estimate/matrix/route.ts`, `marketing/campaigns/route.ts`, `procurement/bids/[id]/approve/route.ts`, `procurement/requests/route.ts`. The bulk of write routes — RFIs, change orders, invoices, submittals, daily logs, cost catalog — check only tenant match, not role. A `ClientView` or `Subcontractor`-role user can write to these financial/operational resources despite the permission matrix logically saying they shouldn't be able to. This is an inconsistency in wiring, not an absent feature.

`roles`/`company_users` tables (see DATABASE_AUDIT.md) are unused/dead — neither of the two real mechanisms above uses them.

## 3. Routes missing `auth()` — none found unguarded

7 of 121 routes have no Clerk `auth()` call; all 7 reviewed and confirmed legitimately, deliberately unauthenticated:
- `app/api/billing/webhook/route.ts` — HMAC signature verification (`verifyWebhookSignature`), not Clerk (webhooks can't carry a session)
- `app/api/google/calendar/event/route.ts`, `google/docs/create/route.ts`, `google/drive/folder/route.ts`, `google/gmail/send/route.ts` — gated via `requireGoogleToken()` (Google OAuth bearer-token check)
- `app/api/procurement/bids/route.ts`, `app/api/public/procurement-request/[id]/route.ts` — intentionally public; tenant_id is resolved server-side from the request row, never trusted from client input

**No route was found that calls `auth()` but proceeds without checking the returned `userId`.**

## 4. Tenant-scoped queries missing `.eq("tenant_id", ...)`

Broad sweep across all 121 routes found **no unfixed instance of the `manual_measurements`-style bug** (a tenant-scoped table queried with zero tenant filter at all). Three narrower, defense-in-depth gaps found:

1. `app/api/procurement/requests/route.ts` GET — after a properly tenant-filtered `marketplace_requests` query, follow-up lookups against `vendor_bids`/`purchase_orders` filter only by `request_id`/`project_id`, not `tenant_id`. Not directly exploitable (IDs were already tenant-derived), but no defense-in-depth if `project_id` values ever collide across tenants.
2. `app/api/procurement/bids/[id]/approve/route.ts` — after correctly tenant-validating `bid`/`request` upstream, three follow-up `.update()` calls filter only by `id`/`request_id`. Low risk today, but a future reordering of these lines could reintroduce a real cross-tenant write with nothing to catch it.
3. `app/api/takeoff/canvas/manual/route.ts` POST — inserts rows tagged with the caller's own `tenantId` but never validates the client-supplied `project_id` via `assertProjectBelongsToTenant` (unlike most other mutating routes). Lets an authenticated user attach fabricated takeoff rows to an arbitrary `project_id`, including one belonging to a different tenant — a data-integrity gap, not a read-isolation break.

## 5. RLS vs. service-role client — the single most important finding in this audit

**Confirmed: RLS provides essentially zero actual protection in production traffic today.**

- `portal/lib/supabase/server.ts` exposes two client factories: `createClient()` (anon key, cookie/JWT-scoped, subject to RLS) and `createServiceClient()` (service-role key, **bypasses RLS unconditionally** — this is how Postgres/Supabase service roles work by design).
- **91 of 121 route.ts files call `createServiceClient()` directly; the remaining routes that don't call it directly still go through it internally via `lib/project-controls/server.ts`'s shared helpers.** Zero route files import or use the anon/user-scoped `createClient()`.
- `current_tenant_id()` (the function nearly every RLS policy is built on) resolves tenant from `auth.jwt() ->> 'org_id'` — a claim only present on requests authenticated via the anon/authenticated Postgres role. The service-role key doesn't authenticate that way at all; it bypasses `USING`/`WITH CHECK` clauses unconditionally regardless of what `current_tenant_id()` would return.
- **Practical consequence:** the well-formed, real RLS policies backfilled across all 76 tables (`20260706_rls_tenant_isolation.sql`, `20260714_backfill_rls_policies.sql`, the `manual_measurements` bypass fix) are a defense-in-depth layer that is never actually evaluated for any live application traffic. **Tenant isolation today depends 100% on every route author remembering to write `.eq("tenant_id", tenantId)` in application code.** If any future route misses that filter, RLS will not catch it — there is no independent enforcement layer.

This does not mean tenant isolation is broken today (the point-4 sweep found no live unfiltered-query gaps) — it means the system has no backstop if one is ever introduced.

## 6. Admin-bypass mechanisms — reviewed, none are auth/tenant bypasses

- `lib/python-api.ts`'s `isAdminEmail()` (hardcoded `justinatteberry@onyx-iron.com`) swaps in `RATE_LIMIT_ADMIN_SECRET` instead of `ONYX_API_SECRET` when calling Railway — bypasses **rate limiting only**, still requires a valid secret, tenant/project headers unchanged. Server-only, never reaches the browser.
- `lib/ai/rate-limit.ts` — same admin email bypasses the in-app AI rate limiter entirely — again, rate limiting only, no auth/tenant bypass.
- `app/api/admin/comp-access/route.ts` + `app/api/cost-catalog/ingest/{bls,dot,oce}/route.ts` — genuine, server-enforced `requireAdmin()` gates (Clerk `auth()` + `currentUser()` email comparison) restricting billing-comp-access and bulk cost-index ingestion to the one hardcoded email. This is a legitimate authorization gate, not a bypass. The client-side `isAuthorized` check on the comp-access page is cosmetic only — the API route re-enforces server-side.
- **Maintainability note, not a vulnerability:** the hardcoded admin email is repeated independently in 5+ files rather than centralized behind a single shared check — a future typo or inconsistent edit could silently create a gap, though none exists today.

## 7. Client-side-only authorization — none found

The one role-gated UI flow (`TeamManager.tsx`'s `isAdmin` prop hiding invite/remove controls) has real server-side re-enforcement in the corresponding API routes. The `admin/comp-access` page's client-side `isAuthorized` check is similarly backed by a server-side `requireAdmin()`. **No case was found of a client-only permission check with no corresponding server-side enforcement.** Worth noting as a related gap: the front-end for RFIs/change-orders/invoices doesn't attempt to hide write UI based on the `project_profiles.role`/`WRITE_MATRIX` system at all — consistent with point 2's finding that this permission system isn't wired into those routes either.

## Summary — the two findings to prioritize

1. **Service-role-everywhere (point 5)** — RLS is real but not load-bearing; one future missed tenant filter is a full cross-tenant leak with nothing to stop it.
2. **Inconsistent permission-matrix wiring (point 2)** — a well-designed role/permission system exists but only covers 4 of the routes it logically should.
