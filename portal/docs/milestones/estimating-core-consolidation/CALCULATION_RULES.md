# Calculation Rules

All calculations live in `lib/estimating/calculations.ts` — the single source of truth every write path (versions PATCH route, auto-sync, seed route) calls. No route computes a total by hand.

- **Direct cost** = labor + material + equipment + trucking + subcontract + disposal + testing + other direct cost.
- **Cost before profit** = direct cost + indirect cost + contingency + overhead.
- **Selling price (total_price)** = cost before profit + profit.
- **Markup** = profit / cost before profit. Field name: `markup`. Never stored as a column — always derived at read time.
- **Margin** = profit / selling price. Field name: `margin`. Different denominator from markup by design; the two are never interchangeable and never share a field.
- Division by zero (zero cost-before-profit for markup, zero selling price for margin) returns `null`, not `0` or `NaN` — "undefined," not "zero percent."
- Currency values are rounded once, at the end of each calculation, via `roundCurrency` (standard half-up rounding to the cent) — intermediate sums are kept at full precision so rounding error cannot compound across category sums.

## Percentage application (contingency/overhead/profit)
Applied at the **version level** via `applyVersionPercentages`, using the same cascade the legacy Pricing Matrix used (so migrated totals reconcile exactly): `direct → +contingency% → ×(1+overhead%) → ×(1+profit%)`. `contingency_pct`/`overhead_pct`/`profit_pct` are stored on `estimate_versions` — the calculation *inputs*, not just the outputs — so every version's totals are reproducible from what's stored, satisfying STEP 3's "store either the inputs or the outputs + metadata" requirement with the inputs path. Per-item overrides are still possible: if a client-supplied item patch explicitly includes `contingency`/`overhead`/`profit` dollar amounts, those are used as-is instead of being derived from the version percentage (item-level override, STEP 6's "support calculations at item level... cost-code level... estimate level").

## Never trust the browser
The versions PATCH route (`app/api/estimate/versions/[id]/route.ts`) never persists a client-supplied `total_price`/`unit_price`/`total_direct_cost` — every write recomputes them from the cost-category inputs via `calculateItem`. Every GET response for a version's items/totals is likewise a fresh `calculateEstimateTotals` roll-up over the stored rows, not a cached/stored aggregate trusted at face value.
