# Role Visibility Matrix

## Current model (`lib/project-controls/permissions.ts`)

7 roles: `Owner`, `Admin`, `Estimator`, `ProjectManager`, `FieldSuperintendent`, `Subcontractor`, `ClientView`.

3 gated resource categories: `financial`, `field`, `admin`. 2 actions: `read`, `write`.

```
canPerform(role, resource, action):
  if action === "read": return true            // <-- every role can read everything
  if role in READ_ONLY_ROLES (ClientView): return false
  return WRITE_MATRIX[resource].has(role)
```

| Role | financial write | field write | admin write | read (all categories) |
|---|---|---|---|---|
| Owner | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ |
| Estimator | ✅ | ✅ | ❌ | ✅ |
| ProjectManager | ✅ | ✅ | ❌ | ✅ |
| FieldSuperintendent | ❌ | ✅ | ❌ | ✅ |
| Subcontractor | ❌ | ✅ | ❌ | ✅ |
| ClientView | ❌ | ❌ | ❌ | ✅ |

## Confirmed gap

**Every role can currently read financial data**, including `Subcontractor` and `ClientView` — there is no read-side gate at all in `canPerform`. This directly conflicts with the master prompt's requirement: *"Hide financial values and financial workspaces from restricted roles."*

Individual routes may or may not add their own extra financial-visibility check independently of this shared helper — that was not exhaustively verified route-by-route in Phase 1 (130 routes; a targeted grep for routes calling `assertPermission(..., "financial", "read")` found none, meaning if any such check exists it isn't using the shared helper).

## Required before Financials workspace ships to restricted roles

1. Extend `canPerform`/`assertPermission` to gate `read` as well as `write` for the `financial` category (a small, additive, backward-compatible change — existing callers that only check `write` are unaffected).
2. Apply that gate at the Financials workspace's data-fetching layer (not just hide UI elements client-side — a restricted role must not receive the data in the API response at all).
3. Re-verify with an integration test: a `ClientView`/`Subcontractor` role cannot read `estimate_items.unit_cost`/`labor_cost`/etc. or invoice amounts via the API.

This is flagged as required work for Phase 2/3 (when the Financials workspace and role-based nav visibility are actually built) — not fixed in this Phase 1 audit pass, per the instruction to keep Phase 1 to audit + architecture + CI baseline.
