# Current Calibration Model (as found)

## What `scale_ratio` meant

`sheet_calibrations.scale_ratio` = real-world units per **current-render-pixel**, computed client-side:

```
ratio = known_distance_ft / pixelDistance(calibPts[0], calibPts[1])
```

where `calibPts` were captured in `SheetCanvas.tsx`'s current SVG pixel space (`toLocal`), at whatever `renderScale` (`page.getViewport({scale})`) happened to be active when the user clicked. The client sent only the final `ratio` number — the server never learned what render scale produced it.

## The bug

If a user calibrated a sheet at one window size and later drew/measured in a differently-sized window (different `renderScale`), every `pixelDistance(pts) * scale` calculation was wrong by the ratio of the two render scales. This is the same class of bug fixed for geometry storage in the professional-manual-takeoff milestone, but calibration itself was out of scope there.

## Every consumer of `scale`/`scale_ratio` (pre-fix)

- `SheetCanvas.tsx`: `draftQuantity` (length/area preview), `finishDraft` (length/area commit), `finishUtilityDraft`/`commitUtilityRun` (pipe run length), `finishAreaBoundsDraft` (area/volume), `compileToSurfaceMesh` (topo mesh export), `CADVectorLayer`'s `scaleRatio` prop (CAD vector → pixel conversion), auto-topo-match's real-world → pixel conversion.
- All of these multiply/divide by `scale` assuming it means "real-world units per pixel **in the CURRENT render**" — which was only true if the render scale hadn't changed since calibration.

## Legacy row inventory

Existing `sheet_calibrations` rows have `scale_ratio` populated and no page-space points at all — there is no stored render scale to reconstruct what pixel size the ratio was computed against, so a deterministic conversion to page-space is impossible for these rows (see `LEGACY_MIGRATION_POLICY.md`).
