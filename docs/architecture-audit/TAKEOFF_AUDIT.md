# Takeoff Audit (Manual + AI/Vector)

## Manual takeoff workflow

Pipeline: PDF render (`pdfjs-dist`) → scale calibration (2-click + `window.prompt` for real-world distance → `scale_ratio`) → geometry creation (canvas pixel-space point arrays) → client-side unit conversion (pixels × scale / scale²) → local React state (`saved: boolean` flag per shape) → `saveAllUnsaved()` POSTs to 4 parallel endpoints → refresh reloads from server.

**Confirmed: refreshing the browser reloads all successfully-saved data.** No local-only data survives only in memory once saved. However, **any unsaved draft shape sitting in React state before `saveAllUnsaved()` is called is lost on refresh** — no localStorage/autosave layer exists.

**Save failure handling:** if one of the four parallel save endpoints fails, none of the local `saved` flags flip and the user is alerted — but there's no partial-success handling and **no idempotency key** on the manual/utility/topo/area-bounds routes, so a retry after a partial failure could create duplicate rows for whatever did succeed.

### `takeoff_items` field-by-field persistence audit

| Required field | Present? | Detail |
|---|---|---|
| `tenant_id` | Yes | every insert path |
| `project_id` | Yes | every insert path |
| `document_id` | Partial | present, but the manual-canvas path mislabels it — `document_id: it.page_id ?? null` (repurposed field, not an actual document reference) |
| **Document version** | **Absent** | No column; only the soft filename-derived `meta.family_key` on the parent `documents` row, never copied to `takeoff_items` |
| `sheet_id`/page | Partial | `page` (int) exists, but no proper FK column to `document_pages.id` — only baked into `meta` in some paths |
| **Sheet revision** | **Absent** | No concept anywhere on `takeoff_items` |
| **Geometry** | **Absent from `takeoff_items`** | Lives only on `manual_takeoffs.geometry`, never copied over — the estimate-facing table has no geometry at all |
| **Scale** | **Absent** | Calibration lives in a separate table, never linked to or copied into `takeoff_items` |
| `unit`, `quantity` | Yes | every path |
| `cost_code` | Yes, as `csi_code` | every path |
| **Assembly** | **Absent** | No assembly/grouping concept on `takeoff_items` at all |
| **Creator (`user_id`)** | **Absent from `takeoff_items`** | `manual_takeoffs` DOES capture `created_by`, but it's lost the moment the row is mirrored into `takeoff_items` — the estimate-facing table has no record of who created any given line |
| **Approval status** | **Absent** | No column; closest analog is `pricing_status` on the *different* `estimate_items` table |
| Audit history | Weak | Only coarse `logEvent()` fire-and-forget "N items saved" activity entries — no per-field change log, no edit history |

Estimate linkage: manual canvas saves mirror directly into `takeoff_items` (tagged `extraction_method: "manual"` or `"ai_vision"` if sourced from vision), then call `syncTakeoffToEstimate` — flows automatically, no manual import step.

## AI/vector takeoff workflow

### Deterministic engine (`takeoff_extract.py`) — real, grounded

`CSI_RULES` — ordered regex classification, most-specific-first. Deterministic math confirmed real across every format: PDF table extraction reads actual cells (`pdfplumber`), DXF sums real vector geometry with unit conversion, IFC reads real BIM base quantities, XLSX reads real cell values. Every row cites its literal source (page/column/layer/element) in `quantity_basis`. Vector-complexity routing (`LINE_COMPLEXITY_LIMIT=1200`) sends genuinely ambiguous/non-tabular pages to AI-vision fallback — this gate is sound.

### AI vision fallback — two separate paths, one confirmed rule violation

**Path A** (`takeoff/extract/route.ts`, whole-PDF fallback): rows returned to the client, user must explicitly `persistRows` before anything is saved. **This is a real, working manual-approval gate.**

**Path B** (`takeoff/canvas/vision-extract/route.ts`, per-page canvas path) — **THE REQUIRED FINDING:**

Per the code's own comment: *"Vision findings used to require a manual per-item 'Approve' click before becoming a real takeoff row... it no longer requires a human click just to exist in the takeoff."* This was a deliberate change made earlier this session (explicitly chosen by the product owner as "fully automatic end-to-end").

**Assessment: this is a genuine violation of "no AI-generated quantity may automatically become an approved estimate quantity."** The route unconditionally inserts vision-extracted items into `takeoff_items` (tagged `extraction_method: "ai_vision"`) and immediately syncs into `estimate_items` with `pricing_status: "review"` — before any human looks at it. The soft `pricing_status: "review"` flag is a labeling convention on a row that already exists live in the estimate, not a gate that prevents the row from existing there. Nothing in the reviewed code enforces that "review" rows are excluded from cost rollups, PO generation, or client-facing exports — that would need separate verification in the estimate summary/export code. As implemented, "review" is advisory metadata, not an access-control gate. The previous behavior (hard gate: item didn't exist until approved) was a stronger guarantee than the current one (soft label on an already-committed row).

**No cross-check exists between AI-claimed quantities and any deterministic/vector-derived value.** Neither vision-extraction path validates the model's self-reported `quantity`/`total_qty` against ground truth — the only safeguard is a prompt instruction ("never invent quantities you cannot see"), which is not code-enforced.

**AI asked to do arithmetic that should be deterministic:** both vision-extraction prompts instruct the model to "read every existing/proposed elevation visible, area-weight them across the graded region rather than a flat few-point average" — genuine area-weighted-averaging math, delegated to natural-language reasoning rather than the codebase's own real surface-mesh/grid cut-fill calculator (`SheetCanvas.tsx`'s `compileToSurfaceMesh`, which computes earthwork from a coordinate mesh correctly elsewhere in the app). The grading-plan cut/fill case is the one place these two paradigms collide: real deterministic infrastructure exists, but the AI vision prompt asks Gemini to informally replicate it by "reading" and "eyeballing" elevations.

Where deterministic math **is** used correctly: `calcPipeEmbedment` (trench excavation/bedding math), DXF geometry summation, and the topo/surface-mesh compile path.
