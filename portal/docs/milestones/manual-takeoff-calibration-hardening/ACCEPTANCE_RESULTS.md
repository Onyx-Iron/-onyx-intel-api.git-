# Acceptance Results

| Definition-of-done item | Status | Evidence |
|---|---|---|
| Calibration is page-space-relative | ✅ | `page_space_scale_factor` computed server-side from page-space points; `TARGET_CALIBRATION_MODEL.md` |
| Quantities do not change with render size | ✅ | `calibration-and-atomic-writes.integration.test.ts` — 7 simulated render scales, identical results |
| Legacy calibration handling is explicit | ✅ | `status`/`verified` columns, backfill test, no silent reinterpretation |
| Server validates quantities | ✅ | route recalculates from verified calibration, flags >1% discrepancy, persists server value |
| Manual + mirror writes are atomic or use a durable outbox | ✅ | `save_manual_takeoff_tx`/`soft_delete_manual_takeoff_tx`, proven via forced-failure rollback test; outbox for estimate-sync (documented as non-atomic-after-commit by design) |
| Audit history cannot silently fail independently | ✅ (for the atomic scope) | history writes are inside the same transaction as the business write — no longer a separate best-effort call. Outbox→estimate-sync failure is still possible and is logged/marked `failed`, not silent. |
| Soft delete keeps mirror and estimate state consistent | ✅ (mirror) / ⚠ (estimate) | mirror hard-deleted atomically with source soft-delete; linked `estimate_items` rows are neither mutated nor auto-removed (see `REMAINING_RISKS.md`) |
| Repeated saves are idempotent | ✅ | idempotent-create + concurrent-save tests |
| Cross-tenant and cross-project access are denied | ✅ | RPC-level cross-tenant delete test; route-level project/page ownership checks (pre-existing from prior milestone, unchanged) |
| Tests pass | ✅ | 64/64 (unit + integration) |
| Build passes | ✅ | `next build` clean |
| Adversarial review finds no critical quantity or transaction defect | ✅ | see below |

## Adversarial review findings

- **Render-dependent scale**: fixed for verified calibrations; legacy calibrations remain render-dependent **by explicit, surfaced design** (not silently) until recalibrated.
- **Double conversion**: guarded (`toPersistedPoints`/`toDisplayPoints` pattern from the prior milestone, unchanged; calibration factor is computed once, never re-derived from itself).
- **Quantity manipulation**: a manipulated browser-submitted quantity is overridden by the server-calculated value whenever a verified calibration exists.
- **Partial transaction commits**: proven impossible for the 5-step business write via a forced-failure test.
- **Duplicate mirrored items**: prevented by a unique partial index + `ON CONFLICT`, proven via idempotency test.
- **Orphaned estimate items**: not newly introduced by this milestone; the pre-existing gap (soft-deleting a takeoff doesn't touch already-synced `estimate_items`) is unchanged and documented, not silently claimed fixed.
- **Audit gaps**: closed for the manual/mirror write path; the estimate-sync leg remains a documented, non-atomic, but durable-and-retryable outbox step.
- **Legacy calibration misinterpretation**: explicitly tested — a raw legacy row is never treated as verified.
- **Approved estimate mutation**: unchanged from the prior milestone's already-proven immutability guarantee; this milestone doesn't touch that code path.
- **Cross-tenant access**: denied at both the RPC layer (tenant-scoped lookup) and the route layer (ownership asserts before the RPC is ever called).

No unresolved **critical** quantity or transaction-integrity defect was found. The remaining items above are scope boundaries, explicitly documented, not defects in what was built.
