# Versioning Model

## Statuses
`draft → review → approved → superseded | void`. Enforced by a CHECK constraint on `estimate_versions.status`.

## Immutability — two independent layers
1. **Application layer**: `assertVersionEditable` (`lib/estimating/versioning.ts`) throws `VersionLockedError` (409) for any PATCH/DELETE against a non-draft/review version, checked by every write route before touching `estimate_items`.
2. **Database layer**: the `prevent_locked_estimate_item_write` trigger on `estimate_items` blocks INSERT/UPDATE/DELETE against a row whose version is `approved`/`superseded`/`void`, independent of which code path attempts the write (defense-in-depth against a bug in the application check, or a future direct-SQL script). Verified live: a raw `UPDATE estimate_items SET ...` against an approved-version row fails with `Cannot update an estimate_item belonging to a approved estimate version`.

The trigger's UPDATE/DELETE check reads the row's **prior** (`OLD`) version status, not the target (`NEW`) one — this is what lets the one-time data migration assign a version to previously-unversioned rows (`OLD.estimate_version_id IS NULL`) without being blocked, while still blocking any edit to a row that was already locked.

## Creating a new draft (`createDraftFromVersion`)
Copies every item from a source version into a fresh draft (new ids, same cost data), carrying forward the source's `contingency_pct`/`overhead_pct`/`profit_pct`. Used for:
- **"Edit an approved estimate"** — the UI's "New Draft to Edit" button.
- **"Restore as new draft"** — same function, called with any historical version (draft, approved, or superseded) as the source.
- **Automatic re-open on a locked current version** — `getOrCreateDraftVersion` (shared by takeoff auto-sync and the pricing-matrix seed action) transparently opens a new draft, seeded from the locked current version, whenever a write needs to happen and the current version is locked. A takeoff quantity change therefore always lands in a draft, never silently mutating the approved version.

## Approval (`approveVersion`)
Marks the target version `approved`, marks the estimate's *previous* current version `superseded` (only if it was itself `approved` — a draft/review predecessor that never got approved is simply left behind, not marked superseded, since "superseded" specifically means "was once the approved one"), and updates `estimates.current_version_id`.

## Comparison / restore
"Compare versions" and "restore as new draft" are satisfied structurally: every version's items are independently queryable by `estimate_version_id` (a diff is a client-side comparison of two `GET /api/estimate/versions/[id]` responses — no separate diff endpoint was built, since the data needed for one already exists per-version); "restore as new draft" is exactly `createDraftFromVersion` called with an old/superseded version as the source.

## Audit
`estimate_audit_log` (mirrors the `takeoff_item_history` append-only pattern) records estimate/version/item/proposal/SOV creation, item edits/deletes (with before/after), approvals, and buyer adjustments — every entry carries `actor_user_id`.
