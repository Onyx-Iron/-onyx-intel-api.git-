# OSS Peer Optimization Research

**Date:** 2026-10-03  
**Scope:** Compare Onyx Intel modules against open-source peers and extract **legal, re-implementable** patterns (not wholesale code copies).  
**Aligned with:** `docs/architecture-audit/RECOVERY_ROADMAP.md`

> **Start here for non-construction domains** (document parsing, pricing data, CAD/BIM, RLS, RAG, CI, observability): see [`CROSS_DOMAIN.md`](./CROSS_DOMAIN.md).  
> This file focuses on **construction takeoff / estimating product peers**. The two docs together are the full playbook.

> This document is research + a prioritized backlog. No peer code was copied into the product. Where a peer is AGPL, only **ideas and architecture** are cited.

---

## 1. Legal rules (non-negotiable)

| Do | Don't |
|---|---|
| Study public GitHub repos via normal API / browsing | Bulk-scrape GitHub in ways that violate their ToS |
| Reuse **MIT / Apache-2.0 / BSD** code with attribution when you intentionally vendor it | Paste **AGPL-3.0** code into a closed SaaS without legal review (network copyleft) |
| Re-implement algorithms and UX patterns in Onyx's own style | Copy proprietary SaaS UIs/code (Procore, PlanSwift, Bluebeam, etc.) |
| Keep a "borrowed ideas" log (this file) | Assume "similar" = "free to ship verbatim" |

### Peer license summary

| Peer | License | Use in Onyx |
|---|---|---|
| [Kentucky-ai/opentakeoff](https://github.com/Kentucky-ai/opentakeoff) | Apache-2.0 | Patterns + optional attributed reuse of small helpers |
| [buildvisionai/construction-calculators](https://github.com/buildvisionai/construction-calculators) | MIT | Safe to depend on npm/PyPI or reimplement |
| [DynMEP/YOLOplan](https://github.com/DynMEP/YOLOplan) | Check LICENSE before vendoring | Ideas for symbol detection; verify before code reuse |
| [braedonsaunders/bidwright](https://github.com/braedonsaunders/bidwright) | **AGPL-3.0-only** | **Ideas / architecture only** — do not copy source |
| [agu3rra/volpy](https://github.com/agu3rra/volpy) / earthwork math repos | Varies (often GPL) | Prefer reimplementing published math methods |
| ProTakeoff public mirrors | Unstable / 404 on primary URL | Skip until a stable MIT source is confirmed |

---

## 2. What Onyx already does well

Do not "optimize away" strengths while chasing peers:

1. **Deterministic takeoff math with source citations** (PDF tables, DXF, IFC, XLSX) — rare in open takeoff tools.
2. **Server-authoritative estimating** (`portal/lib/estimating/calculations.ts`) with explicit markup vs margin denominators.
3. **Page-space calibration hardening** (`portal/lib/takeoff/calibration.ts`, canvas quantity layer, integration tests).
4. **Transactional outbox** for takeoff → estimate sync (`claim_outbox_events` + `FOR UPDATE SKIP LOCKED`).
5. **Civil grid earthwork** with BCY/LCY/CCY factors and mass-haul summary (`portal/lib/math/earthwork.ts`).

Peers are most useful for **productization patterns** (provenance, evidence, revision UX, typed money, agent/human approval seals) and **gap-fill calculators**, not for replacing core civil engines.

---

## 3. Peers studied (primary)

### 3.1 OpenTakeoff (Apache-2.0) — takeoff canvas excellence

Relevant modules inspected: `web/src/lib/units.ts`, `provenance.js`, `approvals.js`, `sourceTrace.ts`, plus rich canvas libs (`oneclick.ts`, `detectRooms.ts`, `cursorSnap.ts`, schedule OCR, etc.).

**Patterns worth stealing (reimplement):**

| Pattern | Why it matters for Onyx |
|---|---|
| **Internal feet, display-only unit conversion** | Prevents metric users typing meters into foot fields (OpenTakeoff documented a real 3.3× wall-area bug). Onyx should audit all dimension inputs the same way. |
| **Provenance stamps on every mutation** (`origin.actor`, `method`, `edited`, frozen pre-edit verts) | Matches product rule: AI quantities must not silently become approved estimate qty. |
| **Hard approval seals separate from measurements** | Estimator ink vs agent diamond; approvals ride undo; never mint estimator seals from agent paths. |
| **Calibration check verdict** (`checkVerdict`: match ≤1%, close ≤5%) | UX for recalibrate confidence; grades from *displayed* rounded error so chip color never contradicts the number. |
| **Source-trace "◎ from sheet A"** | Jump from a capture/annotation back to origin sheet with bounded retry (max attempts) so stale fly-to never fires. |

**Where Onyx is ahead:** multi-tenant SaaS, CSI classification, Railway Python engine, cost catalog, estimate versioning skeleton.

### 3.2 Bidwright (AGPL — ideas only) — full estimating platform

Relevant modules inspected: `packages/domain/src/{money,price-build,revision-compare,estimate-evidence,quote-engine}.ts`.

**Patterns worth re-implementing (do not copy):**

| Pattern | Onyx gap / action |
|---|---|
| **Branded money types** (`PerUnitCost` vs `LineTotal` vs `MarkupRatio`) | Onyx still mixes unit vs extended semantics in places (version-diff uses `unit_cost` + `total_price` without branded types). Add lightweight branded types or Zod discriminators in `calculations.ts` / DB mappers. |
| **Natural-key revision diff with duplicate-line handling** | Onyx `version-diff.ts` uses `Map` keyed by takeoff id or CSI+description — **collapses duplicate lines**. Bidwright buckets by key and pairs in sheet order. Upgrade `diffEstimateVersions` to multi-match. |
| **Change classification** (quantity / rate / cost / hours) + money epsilon | Onyx only flags any field change; add kind tags + `MONEY_EPSILON = 0.005`. |
| **Evidence kinds + facets** (scope / quantity / rate / adjustment) | Onyx QC checks drawing_ref / location / quantity_basis loosely. Introduce a typed evidence table or JSONB with kinds mirroring takeoff, catalog, assumption. |
| **Customer price-build reconciliation** (hidden adjustments folded into rollup) | When proposal/SOV exports land, ensure printed lines always sum to grand total. |

### 3.3 construction-calculators (MIT) — pure math library

Zero-dependency TS + Python calculators for concrete, gravel, drywall, markup, labor burden, CPM timeline, etc.

**Action:** Prefer **depending on** `@buildvisionai/construction-calculators` for commodity calcs (or reimplement under MIT attribution) rather than inventing one-off formulas in UI. Keep Onyx-specific civil trench/earthwork in `python-engine/` and `portal/lib/math/`.

### 3.4 YOLOplan — symbol detection

Python YOLO11 pipeline for counting symbols on drawings (MEP-focused).

**Action:** Longer-horizon R&D for count tools on canvas; not a near-term merge. If pursued, train on Onyx's own labeled sheets; do not ship someone else's weights without license clearance.

### 3.5 Earthwork / cut-fill peers

| Peer | Takeaway |
|---|---|
| volpy / GPS earthworks | TIN double-integral volumes — useful if Onyx adds survey-point TIN mode beyond grids |
| kml-earthworks | Prismatoid corridor volumes + shrink/swell mass balance — compare against Onyx `massHaulSummary` |
| GRASS `r.earthworks` | Raster cut/fill modeling reference |

Onyx's documented bilinear cell method is already honest about accuracy class; next upgrades are **TIN mode** and **documented method badges** in the UI (grid vs prismatoid vs TIN).

---

## 4. Module-by-module scorecard

Legend: **Ahead** / **Parity** / **Behind** relative to best open peer for that concern.

| Onyx module | Path(s) | Score | Highest-leverage peer lesson |
|---|---|---|---|
| Estimating calculations | `portal/lib/estimating/calculations.ts` | Ahead (semantics) / Behind (typed money) | Bidwright branded `PerUnitCost` / `LineTotal` |
| Version diff | `portal/lib/estimating/version-diff.ts` | Behind | Multi-match keys + change kinds + epsilon |
| Estimate QC | `portal/lib/estimating/estimate-qc.ts` | Parity → Behind | Typed evidence facets (Bidwright estimate-evidence) |
| Versioning / lock | `portal/lib/estimating/versioning.ts` | Parity | Keep; consolidate dual estimate systems (internal roadmap D-04) |
| Outbox sync | `portal/lib/estimating/outbox-worker.ts` | Ahead | Peers rarely have this; keep + add metrics/alerting |
| Calibration / quantity | `portal/lib/takeoff/calibration.ts`, `canvas/quantity.ts` | Ahead | Add OpenTakeoff-style check-verdict UX |
| Canvas snap | `portal/lib/takeoff/canvas/snap*.ts` | Parity | Study OpenTakeoff `cursorSnap` / wall network for next pass |
| Provenance / AI gate | takeoff → estimate paths | Behind | OpenTakeoff origin+approval seals; hard gate for AI (roadmap D-03) |
| Units display | scattered | Behind | OpenTakeoff `units.ts` edge-only conversion |
| Earthwork | `portal/lib/math/earthwork.ts` | Ahead for grids | Document method; optional TIN/prismatoid |
| Document pipeline | `portal/lib/documents/*` | Parity | Surface page failures (roadmap D-12/D-13) |
| Auth / RLS | routes + Supabase | Behind (ops) | RLS-first SaaS templates; not construction-specific |
| Symbol count AI | — | Behind | YOLOplan as research track |
| Commodity assemblies | scope-recipes, cost catalog | Parity | MIT construction-calculators for finishes/materials |

---

## 5. Prioritized backlog (legal + high ROI)

Ordered to complement — not replace — `RECOVERY_ROADMAP.md`.

### P0 — Do these inside Onyx first (no peer code required)

These beat any external scrape:

1. **D-04 consolidate dual estimate systems** (internal defect) — peers cannot fix a split brain.
2. **D-01 RLS posture decision + tests**.
3. **D-03 AI-vision hard approval gate** — OpenTakeoff *approvals* pattern is the product model to emulate.

### P1 — Reimplement peer patterns (small, high value)

| ID | Change | Peer inspiration | License risk |
|---|---|---|---|
| OSS-01 | Upgrade `diffEstimateVersions` to bucket+pair duplicates; classify quantity/rate/total; money epsilon | Bidwright revision-compare | ✅ shipped (ideas only) |
| OSS-02 | Add branded money helpers (`asPerUnit`, `asLineTotal`, `asMarkupRatio`) used by write paths | Bidwright money.ts | ✅ shipped (ideas only) |
| OSS-03 | Calibration **check tool** with match/close/wrong grades from displayed % error | OpenTakeoff `checkVerdict` | ✅ pure helpers shipped |
| OSS-04 | Persist measurement `origin` (`actor`, `method`, `edited`, `author_id`) on canvas shapes / takeoff items | OpenTakeoff provenance | ✅ `origin_actor`/`origin_method`/`origin_edited` + `provenance.ts` |
| OSS-05 | Estimator-only approval records distinct from AI suggestions | OpenTakeoff approvals | ✅ vision mirrors `suggested`; outbox only when `approved` |
| OSS-06 | Edge-only unit conversion module (`internal feet`, display imperial/metric) | OpenTakeoff units.ts | ✅ `portal/lib/takeoff/units.ts` |

### P2 — Product depth

| ID | Change | Peer |
|---|---|---|
| OSS-07 | Typed estimate evidence (kinds + facets) feeding QC blockers | Bidwright estimate-evidence (ideas) |
| OSS-08 | Proposal/SOV price-build that always reconciles hidden adjustments | Bidwright price-build (ideas) |
| OSS-09 | Optional `@buildvisionai/construction-calculators` for concrete/drywall/etc. helpers | MIT package |
| OSS-10 | Earthwork method badge + optional TIN path | volpy / civil literature |
| OSS-11 | Symbol-count R&D spike with self-trained weights | YOLOplan (architecture) |

### P3 — Hygiene from peers' engineering culture

| ID | Change |
|---|---|
| OSS-12 | Prefer pure, DOM-free libs for takeoff math (OpenTakeoff style) — Onyx largely does this; enforce in lint/docs |
| OSS-13 | Golden-file tests for markup↔margin and revision diffs (Bidwright has extensive domain tests) |
| OSS-14 | CI gate (roadmap D-15) — peers ship CI; Onyx still gaps here |

---

## 6. Concrete diffs worth making next (implementation sketches)

### 6.1 Version diff (OSS-01)

Current (`version-diff.ts`): one Map entry per key → duplicate CSI lines collide.

Target behavior:

- Group by key into arrays; pair head↔base in stable order.
- Leftover base → removed; leftover head → added.
- Emit `changes: ("quantity" \| "unit_cost" \| "total_price")[]`.
- Compare money with ±$0.005 epsilon so rounding noise is not a "change".

### 6.2 Money brands (OSS-02)

Add `portal/lib/estimating/money.ts`:

- `roundCurrency` (already in calculations — re-export).
- Document: item `unit_cost` is per-UoM; `total_price` is extended.
- Guard mappers so API never writes extended into unit fields.

### 6.3 Calibration check (OSS-03)

After user places a check dimension with known length:

```
errPct = ((measured - known) / known) * 100
grade  = |round1(errPct)| ≤ 1 → match; ≤ 5 → close; else wrong
```

Store last check on the calibration row for audit (pairs with calibration history).

### 6.4 Provenance + approval (OSS-04 / OSS-05)

Minimum schema fields on canvas / takeoff items:

- `origin_actor`: `human` \| `agent` \| `deterministic_parser`
- `origin_method`: `manual` \| `vision` \| `vector` \| …
- `approval_status`: `unreviewed` \| `approved` \| `rejected`
- `approved_by`, `approved_at` (null unless human)

**Invariant:** estimate rollups and proposal export exclude `approval_status != approved` for agent/vision origins (enforce in `calculateEstimateTotals` / QC / sync).

---

## 7. What we explicitly will not do

- Vendor Bidwright source into Onyx (AGPL).
- Scrape closed commercial products.
- Replace Onyx civil engines with flooring-centric OpenTakeoff math.
- Optimize "every function" in one pass — module backlog above is the sequence.

---

## 8. Suggested next Agent session

Pick **one** item and ship with tests — either construction UX or cross-domain infra:

**Construction (this file):**
1. **OSS-01 version-diff upgrade** (pure TS + unit tests, no schema) — safest first PR.
2. Or **OSS-03 calibration check verdict** if UX is the priority.
3. Or **OSS-04/05 provenance + approval** if AI auto-commit risk is the priority (ties to D-03).

**Cross-domain (`CROSS_DOMAIN.md`) — often higher ROI:**
1. **XD-25** CI gate (`tsc` + unit + Python tests).
2. **XD-01** Docling spike for text-PDF → RAG chunks.
3. **XD-06** Finish TxDOT/Caltrans bid-tab parsers (open pricing data).
4. **XD-14** pgTAP / cross-tenant isolation tests.

---

## 9. Sources consulted

- Local: `docs/architecture-audit/*`, `portal/lib/estimating/*`, `portal/lib/takeoff/*`, `portal/lib/math/earthwork.ts`, `portal/lib/cost/`, `portal/lib/parse/`, `portal/lib/documents/`, `scripts/README.md`
- GitHub (read-only): Kentucky-ai/opentakeoff, braedonsaunders/bidwright, buildvisionai/construction-calculators, DynMEP/YOLOplan, docling-project/docling, Unstructured-IO/unstructured, datadrivenconstruction/OpenConstructionEstimate-DDC-CWICR, ThatOpen/engine_web-ifc, IfcOpenShell/IfcOpenShell, pymupdf/pymupdf4llm
- Topic / web search: construction-estimating, document parsing benchmarks, open cost data, Supabase RLS starters
- See also: [`CROSS_DOMAIN.md`](./CROSS_DOMAIN.md)
