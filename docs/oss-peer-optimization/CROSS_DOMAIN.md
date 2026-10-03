# Cross-Domain OSS Playbook (Not Just Construction)

**Date:** 2026-10-03  
**Companion to:** `RESEARCH.md` (construction takeoff/estimating peers)  
**Goal:** Steal the best **routes, libraries, data sources, and engineering patterns** from any domain that makes Onyx better — document AI, pricing data, CAD/BIM, multi-tenant SaaS, async jobs, observability, geometry, etc.

> Rule: prefer **patterns + MIT/Apache deps + public-domain data**. Reimplement AGPL/GPL ideas. Never ship **CC BY-NC** datasets in a commercial product without a paid license.

---

## 0. Onyx capability map → where to look outside construction

| Onyx surface | Tech reality today | Best external domains to mine |
|---|---|---|
| Document ingest / OCR / Q&A | Edge split → Gemini OCR → `text-embedding-004` → chunks | Docling, Unstructured, PyMuPDF4LLM, PaddleOCR, RAG chunking papers |
| Universal file parse | `portal/lib/parse/*` (pdfplumber/pdfjs, mammoth, xlsx, ezdxf path) | Layout-aware PDF parsers, magic-byte sniffing (you already do some) |
| Takeoff / CAD / IFC | Railway + `ezdxf` + `ifcopenshell` + canvas | ThatOpen `web-ifc`, IfcOpenShell, geospatial volume libs |
| Cost catalog / PPI | Precedence resolver + BLS PPI + DOT stubs | BLS/FRED/OEWS open data; **not** RSMeans dumps; careful with CC BY-NC compilations |
| Estimating / money | Deterministic calc + versioning + outbox | Fintech money types, quote engines (ideas), ERP cost layers |
| Auth / tenancy | Clerk + service-role heavy Supabase | RLS-first SaaS starters, pgTAP isolation suites |
| Async reliability | Outbox + Celery workers | Classic transactional outbox, dead-letter, claim leases |
| AI answers | `grounding.ts` prompt rules | Claim verification / citation-required RAG |
| Frontend data | Newly added React Query provider | TanStack Query staleTime / mutation cache invalidation patterns |
| Ops | Weak CI / console logs | Sentry, OpenTelemetry, GitHub Actions matrices |

---

## 1. Document parsing & RAG (highest leverage outside “construction”)

### Industry ladder (choose by document type)

| Tier | Tool | License | When to use in Onyx |
|---|---|---|---|
| Fast text PDF | **PyMuPDF** / **pymupdf4llm** | Check AGPL vs commercial dual-license for MuPDF stack | Spec books with a real text layer → structured Markdown for embeddings |
| Layout + tables | **Docling** (IBM) | **MIT** | Preferred OSS upgrade for multi-column drawings notes, schedules, tables |
| Broad ETL | **Unstructured** | Apache-2.0 (OSS package) | 60+ formats; good for mixed bid packages (PDF+DOCX+EML) |
| OCR fallback | **PaddleOCR** / Tesseract | Apache / Apache | Scanned sheets when Gemini is down or too expensive |
| Heavy VLM parse | Marker / LlamaParse | GPL / commercial | Ideas only unless license cleared |

**Benchmark signal (OpenDataLoader Bench, public):** Docling leads overall quality among open engines; Unstructured `hi_res` strong on reading order; Marker competitive but GPL.

### Recommended Onyx route (document pipeline)

```
Upload
  → magic-byte sniff (already in parse/index.ts)
  → IF text-layer PDF: Docling or pymupdf4llm → Markdown/JSON blocks
  → IF scan / low text density: Gemini/PaddleOCR page path (keep)
  → chunk by heading/table (not fixed 500 chars)
  → embed with RETRIEVAL_DOCUMENT (pages) vs RETRIEVAL_QUERY (ask)  ← you already split query embeds
  → store bounding boxes / page / section titles with every chunk
  → never mark document "done" if any page OCR/embed failed
```

### Concrete actions

| ID | Action | Why |
|---|---|---|
| XD-01 | Spike **Docling** (MIT) as optional Railway worker for specs/schedules | Better tables + reading order than naive pdfplumber wall-of-text |
| XD-02 | Persist **chunk metadata**: page, heading path, bbox, parser_id, confidence | Peers treat provenance as first-class; your ask/RAG quality depends on it |
| XD-03 | Dual embed task types consistently (document vs query) end-to-end | Aligns with Gemini embedding best practice; reduces retrieval miss |
| XD-04 | Unify whole-document ingest vs page-split path failure visibility | Internal audit D-12/D-13; peers never silently swallow page failures |
| XD-05 | Keep Gemini for *drawing* vision; use layout parsers for *text PDFs* | Don't burn VLM spend on searchable PDFs |

---

## 2. Pricing databases & cost intelligence

### What you can use legally in a commercial SaaS

| Source | Status | Onyx fit |
|---|---|---|
| **BLS PPI** (you already fetch) | Public US gov data | Trend aging — keep; expand series mapping per CSI division |
| **BLS OEWS** wages | Public | Labor rate seeding by metro/SOC code |
| **FRED** construction materials indices | Public (St. Louis Fed) | Alternate/corroborating trend feed |
| **TxDOT / Caltrans bid tabs** (scripts stubbed) | Public agency data | Best civil unit-price calibration — **finish the parsers** |
| **EstimationPro / similar free APIs** | Check ToS per provider | Optional seed; verify redistributability |
| **DDC CWICR** open cost DB | **CC BY-NC 4.0** | ❌ Not for commercial Onyx without a paid DDC license |
| **RSMeans dumps** | Proprietary | ❌ Never scrape/redistribute |
| Tenant actuals / overrides | Your data | Already top of `resolveCost` precedence — correct |

### Recommended cost data architecture (matches your resolver)

You already have the right precedence in `portal/lib/cost/resolver.ts`:

`tenant_override → actuals_avg → regional_price → national_price → none`

**Upgrade path:**

| ID | Action |
|---|---|
| XD-06 | Complete `fetch_dot_tx.py` / `fetch_dot_ca.py` parsers (highest ROI open cost data) |
| XD-07 | Add OEWS labor ingest → labor_cost column seeds by metro |
| XD-08 | Wire PPI escalation so it *actually* moves estimator-visible prices (audit flagged no-op) |
| XD-09 | Store `source`, `observed_at`, `confidence` on every resolved line (you return them — persist on estimate items) |
| XD-10 | Optional: commercial license inquiry for DDC if you want their harmonized international schema — do **not** silently ingest BY-NC data |

---

## 3. CAD / BIM / geometry (engineering, not “estimating UX”)

| Library | License | Role |
|---|---|---|
| **ezdxf** (already in requirements) | MIT | Keep as DXF authority on Railway |
| **IfcOpenShell** (already) | LGPL | OK as dependency; be careful shipping modified LGPL code |
| **ThatOpen / web-ifc** | MPL-2.0 | Browser IFC viewing / quantity peek without round-trip to Railway |
| **GEOS / Shapely / your `geos_geometry.py`** | LGPL/BSD variants | Keep server-side polygon ops |
| **volpy / GRASS earthworks** | GPL-ish | Ideas for TIN volumes — reimplement |

| ID | Action |
|---|---|
| XD-11 | Evaluate `web-ifc` for in-portal IFC preview (ThatOpen) so users see model quantities before Python extract |
| XD-12 | Document volume method badges (grid bilinear vs prismatoid vs TIN) in UI |
| XD-13 | Keep parallel DXF/PDF workers (`parallel_dxf.py` / `parallel_pdf.py`) — industry direction is parallel page/entity fan-out |

---

## 4. Multi-tenant SaaS, auth, RLS

Construction peers are weak here. Borrow from **SaaS starters**:

| Pattern | Source class | Onyx action |
|---|---|---|
| User-scoped Supabase client + RLS as backstop | Next.js + Supabase starters (e.g. cinderblock-style pgTAP suites) | Migrate hot routes off service-role; or document app-enforced tenancy + lint |
| Hostile-tenant isolation tests | pgTAP fixtures that try cross-tenant SELECT | Add SQL tests proving tenant A cannot read tenant B |
| Clerk = identity only; DB = authorization | Common Clerk+Supabase pattern | Align with AUTHORIZATION_AUDIT |

| ID | Action |
|---|---|
| XD-14 | Add pgTAP (or equivalent) cross-tenant isolation suite |
| XD-15 | Lint/forbid bare `createServiceClient()` outside allowlisted workers |
| XD-16 | Map Clerk org/user → `tenant_members.role` on every financial write (expand route-guards) |

---

## 5. Async jobs, outbox, workers

You are already ahead of most apps with `FOR UPDATE SKIP LOCKED` outbox claiming.

Steal from general distributed-systems practice:

| Pattern | Action |
|---|---|
| Visibility timeout + heartbeat | Extend claim lease while long syncs run |
| Dead-letter metrics | Export `deadLettered` counts to logs/metrics (you compute them — alert on them) |
| Exactly-once *effect* via idempotency keys | Already partly there for estimate sync — apply to document page processors |
| No duplicated business logic in Deno vs Next | Extract sync contract package shared by Edge + portal (you have `estimate-sync-contract.ts` — finish converging page-takeoff-worker) |

| ID | Action |
|---|---|
| XD-17 | Dashboard: outbox depth, oldest pending age, DLQ count |
| XD-18 | Same for Celery/Railway queues (docs already start this) |
| XD-19 | Kill duplicated auto-sync in Edge by calling portal internal route or shared pure module |

---

## 6. AI grounding, citations, hallucinations

Your `grounding.ts` rules are solid. Industry next step:

| Pattern | Tool / idea | Action |
|---|---|---|
| Require structured citations | RAG answer JSON `{answer, citations[]}` | Enforce in `/api/documents/ask` response schema |
| Claim verification | LongTracer-class NLI/STS verifiers | Optional post-check on high-stakes answers |
| Never auto-approve vision qty | OpenTakeoff approvals (see RESEARCH.md) | Hard gate |

| ID | Action |
|---|---|
| XD-20 | Zod-validate ask responses to include citation chunk ids |
| XD-21 | Reject answers that mention numbers not present in retrieved chunks (heuristic) |

---

## 7. Frontend / API engineering

| Area | Best practice to adopt |
|---|---|
| Server state | TanStack Query: query keys already starting in `takeoff/queries.ts` — expand to documents, estimates, outbox |
| Mutations | Invalidate precise keys; optimistic UI only with rollback |
| Money display | Formatters that never recompute totals in the browser for authoritative prices |
| Error UX | Map Python 401/misconfig to "Railway secret missing" not generic network fail |
| Env fail-fast | Reject empty `PYTHON_API_URL` / `ONYX_API_SECRET` in production (audit: silent localhost fallback) |

| ID | Action |
|---|---|
| XD-22 | Production boot check: required secrets present or `/api/health` degraded |
| XD-23 | Expand React Query coverage for documents + estimate matrix |
| XD-24 | Typed error codes from Railway → portal |

---

## 8. Observability & CI (boring, massive ROI)

Peers that "feel professional" almost always have:

1. CI: `tsc` + lint + unit tests on every PR  
2. Error tracking (Sentry / OpenTelemetry) on Next + Edge + Python  
3. Structured logs with `tenant_id`, `project_id`, `request_id`

| ID | Action |
|---|---|
| XD-25 | GitHub Actions: portal `typecheck` + `test:unit` + Python `unittest` |
| XD-26 | Sentry (or OTel) on Vercel + Railway + Edge Functions |
| XD-27 | Correlation IDs across portal → Railway → Edge |

---

## 9. Geometry / numerical engineering

| Domain | Library / method | Onyx note |
|---|---|---|
| Robust polygons | GEOS (you added `geos_geometry.py`) | Prefer GEOS over hand-rolled for unions/offsets |
| Grid volumes | Your bilinear cell method | Document accuracy class |
| Survey TIN | volpy-style double integrals | Future mode |
| Numeric stability | Decimal/money at boundaries; float for geometry | Keep currency rounding at edges only |

---

## 10. Master prioritized backlog (cross-domain)

### P0 — reliability / trust (any domain)

1. **XD-25** CI gate — ✅ already present (`.github/workflows/ci.yml`)  
2. **XD-04 / D-12 / D-13** document pipeline failure visibility  
3. **XD-22** fail-fast secrets in production — ✅ `pythonApiBaseUrl` / `pythonApiSecret` + `/api/health`  
4. **XD-14 / D-01** RLS or tested app isolation  

### P1 — data quality

5. **XD-01** Docling spike for text PDFs  
6. **XD-06** Finish TxDOT/Caltrans bid-tab ingest — ✅ CSV/PDF parsers for TX+CA  
7. **XD-08** Make PPI escalation estimator-visible — ✅ resolve-time aging + `pct_change_90d` + cost_prices escalation  
8. **XD-02** Rich chunk metadata  

### P2 — product depth

9. **XD-11** web-ifc preview  
10. **XD-20** cited ask responses  
11. **XD-17** outbox/ops dashboard  
12. Construction UX items from `RESEARCH.md` (OSS-01…05)

### Explicit non-goals / legal landmines

- ❌ DDC CWICR data in production without commercial license (CC BY-NC)  
- ❌ RSMeans / proprietary cost scraping  
- ❌ AGPL Bidwright source in closed SaaS  
- ❌ GPL Marker as a hard dependency without legal OK  

---

## 11. “Best route” cheat sheet (decision tree)

**Parsing a file?**

- Text PDF + needs RAG → Docling (MIT) or Unstructured  
- Text PDF + quantity tables for takeoff → keep Railway deterministic parsers  
- Scan / drawing → Gemini/PaddleOCR + human approval  
- DXF → ezdxf; IFC → ifcopenshell (+ optional web-ifc UI)  
- XLSX/CSV contacts/prices → existing parse modules  

**Pricing a line?**

1. Tenant override  
2. Tenant actuals  
3. Regional DOT/catalog  
4. National seed  
5. PPI age the last known price  
6. Else unpriced + QC blocker  

**AI said a number?**

- Must cite chunk/takeoff row OR be marked `review`  
- Never enter approved estimate totals without human seal  

---

## 12. Sources

- Docling: https://github.com/docling-project/docling (MIT)  
- Unstructured: https://github.com/Unstructured-IO/unstructured  
- PyMuPDF4LLM: https://github.com/pymupdf/pymupdf4llm  
- OpenDataLoader Bench (parser quality table)  
- DDC CWICR: https://github.com/datadrivenconstruction/OpenConstructionEstimate-DDC-CWICR (CC BY-NC — commercial caution)  
- BLS PPI / OEWS, FRED WPUSI012011  
- ThatOpen web-ifc: https://github.com/ThatOpen/engine_web-ifc  
- IfcOpenShell: https://github.com/IfcOpenShell/IfcOpenShell  
- Local audits: `DOCUMENT_PIPELINE_AUDIT.md`, `AUTHORIZATION_AUDIT.md`, `scripts/README.md`, `portal/lib/cost/resolver.ts`
