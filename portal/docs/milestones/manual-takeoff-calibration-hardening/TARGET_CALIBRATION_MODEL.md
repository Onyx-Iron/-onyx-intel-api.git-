# Target Calibration Model

## Schema (`sheet_calibrations`, additive columns)

| column | meaning |
|---|---|
| `point_a_x/y`, `point_b_x/y` | The two calibration clicks, in **page space** (see `lib/takeoff/canvas/coordinates.ts`) — fixed regardless of window size/zoom. |
| `known_distance`, `known_unit` | The real-world distance the user entered between those two points. |
| `page_space_scale_factor` | **Authoritative.** Real-world units per page-space-unit. Computed server-side, once, from the page-space points + known distance. Never recomputed from current-render pixels. |
| `coordinate_system_version` | `'v1'` — reserved for a future page-space definition change. |
| `status` | `legacy_render_space` \| `migrated` \| `verified` \| `needs_verification`. |
| `verified` | boolean gate used to withhold estimate-sync/new-approval on unverified sheets. |
| `active` | reserved for future multi-scale-region support (see below). |
| `project_id` | denormalized for ownership checks without an extra join. |

## Core rule

```
real_quantity = page_space_geometry_quantity × page_space_scale_factor
```

Never `current_render_pixels × historical_render_pixel_scale`.

## Backward-compatible `scale` derivation (client)

`SheetCanvas.tsx` keeps every existing `pixelDistance(pts) * scale` / `polygonArea(pts) * scale * scale` call site **unchanged**. Only how `scale` itself is derived changed:

```ts
const scale = calibration?.page_space_scale_factor != null
  ? calibration.page_space_scale_factor / renderScale   // render-scale-independent, recomputed every render
  : calibration?.scale_ratio ?? 1;                        // legacy fallback, unchanged (render-scale-dependent) behavior
```

This means a verified calibration is correct at *any* render scale without touching the ~15 formula call sites that already existed — the compensation happens once, at the point where `scale` is derived.

## Scale types supported

- **Known-distance calibration** — the only mechanism implemented (two clicks + a real-world distance). Matches the pre-existing UX exactly; only the storage model changed.
- **Sheet-default** — one calibration per `page_id` (existing `UNIQUE(page_id)` constraint, unchanged).
- **Measurement-level override** — not present before this milestone and not added; out of scope.

## Deferred (explicitly not built)

- Multiple scale regions per sheet (`active` column reserved for this).
- Architectural/engineering scale presets (1"=20', 1:100, etc.) — the "known distance" flow already covers this if the user does the arithmetic themselves; a preset picker is a UI convenience, not a data-model requirement, and is deferred.
- Metric-scale UI (the `known_unit`/`convertLinearUnit` plumbing already supports it; no UI toggle was added).
