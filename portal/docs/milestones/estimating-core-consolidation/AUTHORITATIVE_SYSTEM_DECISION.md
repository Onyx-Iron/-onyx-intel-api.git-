# Authoritative System Decision

**`estimate_items` (extended) + new `estimates`/`estimate_versions` tables is authoritative.**

| Criterion | estimate_items | project_estimates |
|---|---|---|
| Separate cost categories | No (added this milestone) | Yes |
| Source takeoff linkage | Yes (`source_takeoff_id` FK) | No (unconstrained uuid) |
| Versioning | No (added this milestone) | No |
| Proposal generation | No (added this milestone) | Client-side XLSX only |
| SOV generation | No (added this milestone) | Client-side XLSX only |
| Approvals | Review-status gate on import (Milestone 1) | None |
| Audit history | Yes (`takeoff_item_history` pattern reused) | None |
| Future budget conversion | Straightforward (versioned, cost-coded) | Would need retrofitting everything |
| Least destructive migration | **Additive column migration** | Would require rebuilding source-linkage + review gate from scratch |

## Tables to deprecate
`project_estimates`, `project_financial_settings` — kept, `COMMENT ON TABLE`'d as deprecated, writes disabled at the API layer (`/api/estimate/matrix` POST/PATCH/DELETE now return 410), reads still served for historical continuity. Not dropped.

## Data migration
See `DATA_MIGRATION_PLAN.md`.

## API routes consolidated
- **New:** `/api/estimate/versions` (list/create), `/api/estimate/versions/[id]` (get/patch items/delete item), `/api/estimate/versions/[id]/approve`, `/api/estimate/versions/[id]/proposal`, `/api/estimate/versions/[id]/sov`, `/api/estimate/versions/[id]/buyer-adjustment`.
- **Retired (410):** `/api/estimate/matrix` POST/PATCH/DELETE.
- **Redirected to write the authoritative system:** `/api/estimate/matrix/seed` now inserts into `estimate_items` (via the shared `getOrCreateDraftVersion` helper) instead of `project_estimates`.
- **Unchanged:** `/api/estimate/route.ts`, `/api/estimate/[id]/route.ts`, `/api/estimate/import-takeoff/route.ts` — still valid, now operating on estimate_items rows that are version-linked.

## UI components consolidated
`components/estimate/EstimateMatrix.tsx` — same component, same look (cost-category grid, sliders, XLSX export), rewired to read/write `/api/estimate/versions/*` instead of `/api/estimate/matrix`. Added: version/status badge, "New Draft to Edit" / "Approve Version" actions, a locked-version banner. Not redesigned.
