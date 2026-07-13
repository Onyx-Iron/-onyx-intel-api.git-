# Calculation Rules

Single authoritative module: `lib/takeoff/canvas/quantity.ts` (`FORMULA_VERSION = "v1"`). Both the client (live preview) and the server (authoritative validation) import the same functions — no formula is duplicated in a UI component.

All inputs are **page-space geometry** + a **page-space-relative scale factor** (`page_space_scale_factor`). No function in this module ever takes a render scale or current-render pixels.

| Function | Formula |
|---|---|
| `calculateLinearLength` / `calculatePolylineLength` | Σ segment lengths × scale factor |
| `calculatePerimeter` | closes the polygon, then linear length |
| `calculatePolygonArea` | shoelace formula × scale factor² |
| `calculateRectangleArea` | `\|Δx\| × \|Δy\|` × scale factor² |
| `calculateCircleArea` | `π × (radius × scale factor)²` |
| `calculateCount` | point count (calibration-independent) |
| `calculateAreaVolume` | area × thickness |
| `calculateBoxVolume` | length × width × depth (width/depth are measurement properties, not page-space quantities — no scale factor applied to them) |
| `calculateSlopeAdjustedLength` | hypotenuse of (plan length, plan length × slope%) |
| `convertLinearUnit` | table-driven; throws on an unrecognized unit rather than guessing |

All functions accept an optional `{ wasteFactorPct, multiplier }` and apply `raw × multiplier × (1 + wasteFactorPct/100)`.

## Server-side validation (STEP 7)

`app/api/takeoff/canvas/manual/route.ts`'s POST handler, for each item whose sheet has a **verified** calibration and whose geometry is tagged `page_space`:

1. Recomputes quantity via the matching `quantity.ts` function.
2. Compares to the submitted quantity — outside **1%** tolerance is flagged.
3. **Uses the server-calculated value** (not the submitted one) as the value persisted — chosen over outright rejection so a legitimate float-rounding mismatch between client/server never blocks a save (RULE 11: no silent save failures); the discrepancy is surfaced in the response instead of silently overwritten.
4. Stores `calculation_formula_version`, `calculated_quantity`, `calculated_unit`, `calculated_at` on the `manual_takeoffs` row.

When the sheet's calibration is legacy/unverified, no authoritative recalculation is possible (no scale factor exists) — the submitted quantity is trusted as-is, `calculation_formula_version` stays null, and the response carries a `calibration_warning`.
