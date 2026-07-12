# Authorization Review — Project Membership & Approval Scope

## Question posed by the milestone brief

> Inspect the current project membership/permission model. If project-level
> permissions already exist, enforce them. If they do not exist, document the
> gap and require tenant financial permission plus verified project
> ownership/membership where possible.

## Investigation (two independent passes, same conclusion)

**`lib/project-controls/permissions.ts`** — `assertPermission(tenantId,
clerkUserId, resource, action)` calls `getUserRole(tenantId, clerkUserId)`,
which queries:

```ts
db.from("project_profiles").select("role")
  .eq("tenant_id", tenantId).eq("clerk_user_id", clerkUserId).maybeSingle()
```

No `project_id` filter exists anywhere in this path. The role returned
(`Owner`/`Admin`/`Estimator`/`ProjectManager`/`FieldSuperintendent`/
`Subcontractor`/`ClientView`) is then checked against a static
`WRITE_MATRIX` by resource category (`financial`/`field`/`admin`) — never by
project.

**`project_profiles` table**
(`supabase/migrations/20260706_project_profiles.sql`):

```sql
CREATE TABLE public.project_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  role text NOT NULL DEFAULT 'Estimator' CHECK (role IN (...)),
  UNIQUE (tenant_id, clerk_user_id)
);
```

Despite the name, this is a **tenant-role table**: one row per
`(tenant_id, clerk_user_id)`, not per `(project_id, clerk_user_id)`. There is
no `project_id` column.

**`assertProjectBelongsToTenant`** (`lib/project-controls/server.ts`) checks
only `projects.tenant_id = callerTenantId` — a cross-tenant leak guard, not a
per-user project membership check. It never inspects who the caller is.

**Exhaustive search** for `project_members`, `project_access`,
`project_roles`, `project_permissions`, `assigned_users`, `member_ids`, or
any owner/member column on `projects` itself: zero matches anywhere in
`supabase/migrations/*.sql`, `lib/`, or `app/api/`. The `projects` table's
own columns (per `lib/supabase/types.ts`) are: `address, budget, city,
created_at, end_date, id, meta, name, start_date, state, status, tenant_id,
updated_at` — no membership column of any kind.

**One dangling reference found:** the review route's own doc comment cites
`AUTHORIZATION_AUDIT.md` as containing the fuller writeup of this same gap.
That file does not exist anywhere in the current repo — it was referenced
from an earlier audit phase of this engagement but was apparently never
committed, or was later removed. Flagged in `REMAINING_RISKS.md`; not
fixed here (recreating a stale audit doc is out of scope for this
milestone).

## Verdict

**No project-level membership/permission system exists today.** Every
authorization check in the app — including the takeoff-review approval
endpoint — is tenant-wide. There is no schema, table, or code path anywhere
that answers "is user X specifically a member/approver of project Y."

## Decision for this milestone

Per the brief's own instruction — *"Do not invent a new role system"* — the
takeoff-review approval route (`app/api/takeoff/items/[id]/review/route.ts`)
is **left as tenant-scoped `assertPermission(tenantId, userId, "financial",
"write")`**, unchanged from Milestone 1. Building real per-project membership
(a new table, new role-assignment UI, new backfill for existing tenants)
is a cross-cutting change that would need to be designed once, application-
wide — every other "financial" resource in the app (procurement/PO approval,
the estimate matrix) has the exact same tenant-wide scope today, so scoping
only takeoff-review to project-level would be an inconsistent, one-off
carve-out rather than a real fix.

This is now pinned down by an explicit, permanent test —
`documents the current cross-project approval scope` in
`lib/estimating/takeoff-integrity.integration.test.ts` — asserting today's
actual behavior (a tenant-financial-write user can act on any project's
takeoff item in that tenant). If per-project membership is ever built, this
test will need to change, and that diff will be a deliberate, visible
decision rather than a silent regression.

## What IS enforced, and verified by test, today

- **Cross-tenant approval is denied.** The review route's lookup is
  `.eq("id", id).eq("tenant_id", tenantId)` with `tenantId` always derived
  server-side from the Clerk session (`getOrCreateTenant`) — never from the
  request body. Verified by `cross-tenant approval is denied` (pre-existing,
  Milestone 1) and the new `a client-supplied tenant_id in the request body
  cannot bypass tenant scoping` test.
- **Client-supplied IDs cannot bypass authorization.** The route's `id` path
  param is used only to scope a lookup that is *also* filtered by the
  server-derived `tenantId`; there is no field in the request body that the
  route reads as an authorization input at all (the `action` enum is fixed
  to `"review"|"approve"|"reject"`, not an arbitrary status string).
- **Cross-project (same-tenant) approval is allowed by design**, as
  documented above — not a defect, a scope decision.
