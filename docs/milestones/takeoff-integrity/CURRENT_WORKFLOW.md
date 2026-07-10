# Current Workflow Trace — Takeoff Integrity Milestone

Traced directly against the code as of this milestone's starting point (before this milestone's changes), citing exact files.

## Manual takeoff workflow

1. **User interaction** — `portal/components/takeoff/canvas/SheetCanvas.tsx`. PDF rendered via `pdfjs-dist`; user picks a tool (count/length/area/utility_pipe/spot_elevation/contour_line/civil_area_bounds).
2. **Geometry creation** — canvas pixel-space point arrays built client-side as the user clicks (`SheetCanvas.tsx:343-411`).
3. **Quantity calculation** — client-side: pixel distance/area × `scale_ratio` (from calibration) / `scale_ratio²` (`SheetCanvas.tsx:317-340,494-511`). Trench-specific math (`calcPipeEmbedment`, `lib/math/civil-scope.ts`) runs server-side for utility pipe runs.
4. **Local state** — shapes held in React state with a `saved: boolean` flag per item.
5. **API request** — `saveAllUnsaved()` POSTs unsaved items in parallel to 4 endpoints depending on tool type: `/api/takeoff/canvas/manual`, `/utility`, `/topo`, `/area-bounds`.
6. **Database insert** — each endpoint inserts into its own dedicated table (`manual_takeoffs`, `civil_utility_takeoffs`, etc.), then (as of this session's prior work) mirrors a corresponding row into `takeoff_items` and calls `syncTakeoffToEstimate`.
7. **Database read** — `GET /api/takeoff/items?project_id=` reads back everything scoped by `tenant_id`+`project_id`.
8. **Page refresh** — `SheetCanvas` re-fetches all four saved-item sets on mount; anything already saved reloads correctly. Anything still in unsaved local state at refresh time is lost (no autosave/localStorage layer).
9. **Estimate linkage** — `lib/estimating/auto-sync.ts`'s `syncTakeoffToEstimate` reads `takeoff_items`, dedupes against `estimate_items` by fingerprint/`source_takeoff_id`, resolves pricing, and inserts new `estimate_items` rows.

## AI takeoff workflow

1. **Document upload** — `POST /api/documents/upload` writes to Storage + inserts a `documents` row; fires an unawaited POST to `/api/documents/[id]/ingest` (single-shot path) OR the async page-split pipeline is triggered separately for large documents.
2. **Page processing** — `page-split-worker` Edge Function splits the PDF into per-page files, inserts `document_pages`, fans out to `page-processor` (OCR/embed) and `page-takeoff-worker` (takeoff extraction) per page.
3. **AI/vector extraction** — `page-takeoff-worker` POSTs the page to Railway's `/api/takeoff/extract` (deterministic engine + AI-vision fallback, `takeoff_extract.py`). Separately, the Sheet Canvas's per-page "vision extract" panel (`VisionExtractionsPanel.tsx`) calls `POST /api/takeoff/canvas/vision-extract`, which calls Gemini directly.
4. **Structured result** — both paths return a JSON array of quantity/unit/csi_code/description/confidence rows.
5. **Database insert (as of the START of this milestone)** — `vision-extract/route.ts` and `page-takeoff-worker` both **unconditionally inserted** every AI result into `takeoff_items`, tagged `extraction_method: "ai_vision"`.
6. **Review state (as of the START of this milestone)** — no real gate. A `pricing_status: "review"` string was set on the corresponding `estimate_items` row (added by this session's prior "takeoff governance" commit) — advisory metadata on a row that already existed in the estimate, not a gate preventing the row from existing there at all.
7. **Estimate linkage (as of the START of this milestone)** — `syncTakeoffToEstimate` inserted every takeoff item into `estimate_items` regardless of source, with AI-vision items merely flagged `pricing_status: "review"`.

**This is the exact gap this milestone closes**: steps 5-7 above are replaced with a real `review_status` gate (`suggested` → `reviewed` → `approved`/`rejected`) that determines row existence in the estimate, not just a label on an already-committed row. See IMPLEMENTATION_PLAN.md and TARGET_DATA_MODEL.md for the design, and ACCEPTANCE_RESULTS.md for verification.
