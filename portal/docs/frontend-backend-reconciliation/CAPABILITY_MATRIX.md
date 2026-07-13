# Capability Matrix

Evidence-based inventory of the production codebase (`Onyx-Iron/-onyx-intel-api.git-`, `main` @ `5e55613`), compiled by reading `app/api/**` (130 route files), `app/dashboard/**`, `components/**` (~30 feature directories), `supabase/migrations/**` (53 files, ~40 tables), and the Python takeoff engine (8 root-level modules). Where a research pass's conclusion conflicted with something proven directly earlier in this engagement (e.g. exact HTTP methods on a route I personally built), this document uses the verified fact and notes the correction.

**Status legend:** Complete & exposed · Complete but buried · Backend only · Frontend only · Partially connected · Placeholder · Broken · Duplicate · Deprecated · Experimental

---

## 1. Projects (core)

| | |
|---|---|
| User objective | Create/manage projects, the root entity everything else hangs off |
| Frontend | `/dashboard/projects` (list), `/dashboard/projects/[id]` (detail + `ProjectTabs`) |
| API | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/[id]` |
| DB | `projects` |
| Status | **Complete & exposed** |
| Missing work | None found |
| Acceptance test | Create project → appears in list → open → tabs render |
| Nav | Sidebar "Projects" (already correct) |

## 2. Documents

| | |
|---|---|
| User objective | Upload plans/specs, track processing (split/OCR/vector/embedding) |
| Frontend | `/dashboard/documents` (workspace-wide list, read-only aggregate); `DocumentsTab` inside `ProjectTabs` |
| API | `GET/DELETE /api/documents`, `POST /api/documents/upload`, `POST /api/documents/[id]/ingest`, `GET /api/documents/[id]/pages`, `POST /api/documents/ask`, `POST /api/documents/import-drive`, `POST /api/parse/document`, `GET /api/generated-docs`, `POST /api/takeoff/drive-upload-session(/finalize)`, `GET /api/takeoff/upload-url`, `GET /api/takeoff/split-status` |
| DB | `documents`, `document_pages`, `document_chunks` |
| Status | **Complete but buried** — the workspace-wide `/dashboard/documents` list exists but shows no per-document processing state (split/OCR/vector/embed/failed) at a glance; that detail only surfaces inside a project's canvas |
| Missing work | A document-status workspace showing upload→processing→failure state per file (Section I of target IA) doesn't exist yet — this is real, new UI, not just a nav change |
| Acceptance test | Upload a PDF → see it move through processing states → open in canvas |
| Nav | Sidebar "Documents" (exists); needs the status-workspace upgrade, not a link move |

## 3. Takeoff (canvas + extraction)

| | |
|---|---|
| User objective | Measure/extract quantities from plan sheets, manually or via AI/CAD-vector |
| Frontend | `TakeoffTab` + `SheetCanvas`/`CADVectorLayer`/`VisionExtractionsPanel` inside `ProjectTabs` → Pre-Construction → Takeoff |
| API | `/api/takeoff/canvas/{manual,calibration,area-bounds,topo,utility,vectors,vision-extract,page-url}`, `/api/takeoff/{extract,extract-stream,from-document,items,items/[id]/review}` |
| DB | `manual_takeoffs`, `sheet_calibrations`, `takeoff_items`, `+_history` tables, `estimate_sync_outbox` |
| Status | **Complete & exposed** at the project level (this is the system built/hardened across this engagement's last several milestones — page-space geometry, atomic writes, optimistic concurrency, outbox worker, all live-tested). **No global (company-wide) takeoff workspace exists at all** — a PM can't see "which projects have plans still unprocessed" without opening each one. |
| Missing work | Global Takeoff workspace (Section C of target IA) is net-new UI, not a reconnection |
| Acceptance test | Upload → split → calibrate → measure/extract → review → approve → syncs to estimate (verified end-to-end via live DB tests this engagement; UI click-through not yet done) |
| Nav | No global entry point exists yet |

**Correction to research-agent finding:** `/api/takeoff/canvas/manual` supports `GET`, `POST`, `PATCH`, `DELETE` (not just GET/PUT as one pass reported) — verified directly, since this route was built/modified in this engagement. `calibration` supports `GET`/`PUT`.

## 4. Estimating

| | |
|---|---|
| User objective | Turn approved takeoff quantities into a priced, versioned estimate; adjust; propose; export |
| Frontend | `EstimateTab`/`EstimateMatrix` inside `ProjectTabs` → Pre-Construction → Estimates |
| API | `/api/estimate`, `/api/estimate/[id]`, `/api/estimate/import-takeoff`, `/api/estimate/matrix(/seed)`, `/api/estimate/versions`, `/api/estimate/versions/[id]`, `/api/estimate/versions/[id]/{approve,buyer-adjustment,proposal,sov}` |
| DB | `estimates`, `estimate_versions`, `estimate_items`, `estimate_audit_log`, `estimate_proposals`, `estimate_sov` (authoritative — `project_estimates`/`project_financial_settings` are **Deprecated**, read-only, confirmed by migration comments) |
| Status | **Complete & exposed** at the project level — versioning, immutability trigger, review gating, proposal/SOV generation all exist and were partly verified live this engagement. **No global estimating workspace** (pipeline-wide view across projects) exists. |
| Missing work | Global Estimating workspace (Section D) is net-new UI |
| Acceptance test | Import approved takeoff → priced draft → approve → immutable → buyer adjustment opens new draft → proposal/SOV generate |
| Nav | No global entry point yet |

## 5. Change Orders — **Complete but buried (correction: not actually broken)**

| | |
|---|---|
| User objective | Track scope/price changes against contract |
| Frontend | `ProjectControlsTab` renders a fully wired `ChangeOrderTable`/`ChangeOrderForm` calling `/api/change-orders` for list/create/update/delete |
| API | `GET/POST /api/change-orders`, `PUT/DELETE /api/change-orders/[id]` |
| DB | `change_order_items` (not `project_change_orders` — corrected table name) |
| Status | **CORRECTED FINDING.** The Phase 1 audit's "Broken (all routes unconditionally return 503)" classification was **wrong** — it came from a research pass that misread the routes' `if (error) return ...503` fallback branch as unconditional. Direct code reading + a live-database test (`lib/project-controls/change-orders.integration.test.ts`, 10/10 passing) proves creation, listing, status-cycle updates, deletion, tenant isolation, and the financial pending/approved-value rollup (`getControlSummary`, consumed by `/api/overview` and surfaced in `ProjectTabs.tsx`'s stat cards) all work correctly today, using the exact payload the real route builds. Nothing needed "restoring" — the 503 branch is a legitimate, never-triggered defensive fallback, the same pattern used elsewhere in this codebase (e.g. RFIs/Submittals). |
| Missing work | None found. Reclassified from "Broken" to "Complete but buried" — same gap as RFIs/Submittals (3 levels deep, no global cross-project view). |
| Acceptance test | Verified live: create → list → cycle status draft→pending→approved → rollup sums correctly, excluding drafts → delete. See `change-orders.integration.test.ts`. |
| Nav | Inside Project Controls grouping (per target IA) — already reachable today via `ProjectControlsTab`, just nested |

## 6. RFIs / Submittals

| | |
|---|---|
| User objective | Track information requests and submittal review cycles |
| Frontend | `ProjectControlsTab` |
| API | `/api/rfis`, `/api/rfis/[id]`, `/api/submittals`, `/api/submittals/[id]` |
| DB | `rfi_items`, `submittal_items` (a separate "control DB" pattern per one research pass — needs confirmation it's the same Supabase project, not a second database) |
| Status | **Complete but buried** — functional, but nested three levels deep (Project → Pre-Construction phase → RFIs & Controls subtab) with no global cross-project view |
| Missing work | Global Project Management workspace aggregation (Section E); confirm "control DB" is not a second/duplicate persistence layer |
| Acceptance test | Create RFI → status update → appears in project's RFI list |
| Nav | Project Controls grouping |

## 7. Daily/Weekly Logs, Schedule, Punch List, To-Do, Staff

| | |
|---|---|
| User objective | Field coordination and progress tracking |
| Frontend | `DailyLogTab`, `WeeklyLogTab`, `ScheduleTab`/`GanttView`, `PunchListTab`, `TodoTab`, `StaffTab` — all under Project Management / Closeout phases |
| API | `/api/daily-logs(+photo)`, `/api/weekly-logs(+generate)`, `/api/schedule`, `/api/punch-list`, `/api/todo-items`, `/api/staff` |
| DB | `daily_logs`, `weekly_logs`, `schedule_tasks`, `punch_list_items`, `todo_items`, `staff_members` |
| Status | **Complete but buried** — all functional, all reachable only from inside a project, no global roll-up |
| Missing work | Global Project Management workspace (Section E) |
| Acceptance test | Create daily log → weekly-log AI summary references it |
| Nav | Field grouping (per target IA) |

## 8. Invoicing / Lien Waivers — **Partially connected to a real financial model**

| | |
|---|---|
| User objective | Track AR/AP, invoices, lien waivers |
| Frontend | `AccountsReceivableTab`, `AccountsPayableTab`, `OpenInvoicesTab`, `ClosedInvoicesTab`, `LienWaiversTab` under Invoicing phase |
| API | `/api/invoices`, `/api/invoices/[id]`, `/api/lien-waivers`, `/api/lien-waivers/[id]` |
| DB | `invoices`, `lien_waivers` |
| Status | **Partially connected** — invoice/lien-waiver CRUD is real. **No verified authoritative model exists for contract value, committed costs, actual costs, or forecasted-final-cost** (confirmed by inspecting the schema list — no `budgets`/`commitments`/`cost_forecasts` table exists). Per the master prompt's own explicit instruction, the target Financials workspace must **not** fabricate these — they should be labeled "Not yet available." |
| Missing work | A real budget/commitment/actual-cost data model is a backend gap, not a frontend one — do not build a Financials workspace that implies this data exists |
| Acceptance test | Create invoice → appears in Open Invoices → mark paid → appears in Closed |
| Nav | Financials grouping (invoice/lien-waiver parts only; AR/AP rollup needs the missing model first) |

## 9. Procurement — **Complete but almost entirely unreachable**

| | |
|---|---|
| User objective | RFQ → vendor bids → award → PO → delivery |
| Frontend | `ProcurementBoard` component exists at `/dashboard/projects/[id]/procurement` — **verified directly: no tab or link in `ProjectTabs.tsx` points to this route.** The only trace of procurement in the visible UI is a read-only "N pending" stat card in the project Overview tab. `PublicBidForm` for the external vendor-facing bid link also exists. |
| API | `/api/procurement/requests`, `/api/procurement/bids`, `/api/procurement/bids/[id]/approve`, `/api/public/procurement-request/[id]` (public, unauthenticated by design), `/api/material-vendors(+[id])`, `/api/equipment-suppliers(+[id])` |
| DB | `marketplace_requests`, `vendor_bids`, `purchase_orders`, `material_vendors`, `equipment_suppliers` |
| Status | **Complete but buried, effectively Frontend-orphaned** — this is the clearest concrete example of "backend + frontend both exist, no path connects them" the master prompt describes. This is real, working functionality with literally no way for a user to reach it from the current navigation. |
| Missing work | Add a Procurement tab to `ProjectTabs` (trivial — the page already exists at the expected route) + a global Procurement workspace |
| Acceptance test | From a project, click into Procurement → create request → invite vendor → bid → approve → PO |
| Nav | **Immediate fix candidate: this is a one-line addition to `ProjectTabs.tsx`, not a redesign** |

## 10. Contacts & Companies

| | |
|---|---|
| User objective | Manage contacts, companies, vendors, subs, staff, roles |
| Frontend | `/dashboard/contacts` (workspace-wide), `ContactsTab` (project-scoped), `StaffTab` |
| API | `/api/contacts(+[id],+parse)`, `/api/companies`, `/api/staff(+[id])` |
| DB | `contacts`, `companies`, `staff_members` |
| Status | **Complete & exposed** at workspace level already (Sidebar "Contacts") |
| Missing work | Expand to include vendor/supplier/role views per target IA Section H, without creating a duplicate contacts table (`material_vendors`/`equipment_suppliers` already exist as separate tables — reconciliation should surface them together in UI, not merge the schema) |
| Acceptance test | Add contact → appears in list and in project-scoped view |
| Nav | Already correct; needs expansion not relocation |

## 11. Civil Intelligence

| | |
|---|---|
| User objective | Cut/fill, earthwork volumes, utility runs, topo, stockpiles |
| Frontend | `CivilScopePanels`, `MassHaulMatrix`, `CutFillTab`/`HeatmapCanvas` at `/dashboard/projects/[id]/civil-earthwork` |
| API | `/api/earthwork/{surfaces,volumes,calculate,entrances,pipe-runs,stockpiles,ledger}`, `/api/cut-fill/{surfaces,compute}` |
| DB | `civil_utility_takeoffs`, `cut_fill_surfaces`, `cut_fill_computations`, `civil_area_limits`, `canvas_topo_nodes` |
| Status | **Complete but buried** — reachable via `ProjectTabs` Cut/Fill subtab, no global workspace, and per the master prompt's own caution, no explicit "survey-grade accuracy" disclaimer or per-quantity source/calibration/confidence exposure was found in the UI |
| Missing work | Global Civil Intelligence workspace (Section J); add source/scale/calibration/review-status/confidence display per quantity, not just a number |
| Acceptance test | Draw cut/fill surface → volume computes → source sheet traceable |
| Nav | Civil Intelligence grouping |

## 12. AI Workforce

| | |
|---|---|
| User objective | Understand what each AI agent does, its data sources, and require human approval on consequential actions |
| Frontend | Generic `/api/ai/chat` UI (location not fully mapped), `AgentApprovalFeed` at `/dashboard/agents/pending` (not in Sidebar) |
| API | `/api/ai/{chat,risk-digest,settings}`, `/api/agents/{audit-trails,audit-trails/[id]/decide,daily-log-assistant,risk-scout,tenant-guard}` |
| DB | `agent_runs`/audit-trail tables, `ai_rate_limit_hits` |
| Status | **Complete but buried** — `/api/agents/audit-trails/[id]/decide` is confirmed as the one route that turns an agent recommendation into a persisted mutation (a real, important approval gate — matches the master prompt's "AI must not silently approve financial/contractual/procurement/takeoff decisions" requirement), but there is no unified AI Workforce workspace surfacing agent purpose/last-run/status/citations |
| Missing work | Global AI Workforce workspace (Section K) — net-new UI over already-real backend |
| Acceptance test | Risk Scout flags an item → appears in pending-approval feed → human decides → audit trail records it |
| Nav | Not in Sidebar at all today; `/dashboard/agents/pending` is an orphaned route |

## 13. Marketing

| | |
|---|---|
| User objective | Track campaigns/leads |
| Frontend | `MarketingCommandCenter`, `ProjectAdWrapper` at `/dashboard/marketing` (not in Sidebar) |
| API | `/api/marketing/{campaigns,leads,project-images}` |
| DB | `marketing_campaigns`, `marketing_leads` |
| Status | **Complete but buried** — real CRUD backend, orphaned frontend route |
| Missing work | Global Marketing workspace (Section L); explicit "integration not configured" states where env vars for ad platforms are absent |
| Acceptance test | Create campaign → add lead → status update |
| Nav | Not in Sidebar; needs adding |

## 14. Billing / Admin

| | |
|---|---|
| User objective | Manage plan tier, seats, AI credits, team |
| Frontend | `/dashboard/settings/{billing,team,cost-overrides}` — **confirmed unreachable from Sidebar**, no settings submenu exists |
| API | `/api/billing/{checkout,status,portal,webhook}`, `/api/admin/comp-access`, `/api/team/{invite,members}` |
| DB | `tenants` (billing columns) |
| Status | **Complete but buried** — fully functional pages with zero navigation path today |
| Missing work | Settings & Administration workspace (Section 15 of target nav) |
| Acceptance test | View billing status → upgrade plan → seat count updates |
| Nav | Settings & Administration |
| Security note | `/api/admin/comp-access` hardcodes a single admin email rather than a role check — functional but not scalable; flagged, not fixed in Phase 1 |

## 15. Google Integration

| | |
|---|---|
| User objective | Connect Drive/Calendar/Gmail for document import and scheduling |
| Frontend | `GoogleConnect` component, `GmailInboxCard`/`GoogleCalendarCard` dashboard widgets |
| API | `/api/google/{connect,callback,status,gmail/send,gmail/unread,calendar/event,calendar/upcoming,docs/create,drive/folder}` |
| DB | OAuth tokens table |
| Status | **Complete & exposed** where wired into Documents/Command Center; per **Hold on Clerk edits** instruction from the owner, no auth-adjacent changes made this phase |
| Missing work | None identified beyond what's already tracked in prior-session memory (env var configuration) |
| Acceptance test | Connect → import a Drive file → creates a document record |
| Nav | Embedded in Documents/Command Center, not a standalone workspace |

## 16. Cost Catalog / Pricing

| | |
|---|---|
| User objective | Regional unit pricing, tenant overrides, historical actuals |
| Frontend | `PriceBookManager` at `/dashboard/price-book` (Sidebar-exposed), `CostOverrideManager` at buried settings route |
| API | `/api/cost-catalog(+[id],+v2,+actuals,+overrides,+seed,+ingest/{bls,dot,oce})` |
| DB | `cost_codes`, `cost_prices`, `cost_overrides`, `cost_indices`, `cost_actuals`, `cost_assemblies`, `assembly_components` |
| Status | **Complete & exposed** (Price Book) / **Complete but buried** (overrides) |
| Missing work | Surface cost overrides from within Settings & Administration |
| Acceptance test | Override a regional price → estimate resolver picks it up over the base catalog |
| Nav | Price Book already correct; overrides need Settings home |

## 17. Command Center / Reports

| | |
|---|---|
| User objective | Company-wide operational snapshot |
| Frontend | `/dashboard` (`OnyxIntelDashboard`) — has stats and an AI status-report button; `/dashboard/command-center` is a **second, separate, server-rendered dashboard implementation** not linked from Sidebar |
| API | `/api/dashboard`, `/api/overview`, `/api/status-report`, `/api/search`, `/api/activity`, `/api/audit-logs` |
| DB | Multi-table aggregation, no dedicated table |
| Status | **Duplicate** — two separate Command-Center-shaped pages exist (`/dashboard` and `/dashboard/command-center`) with overlapping purpose. This needs reconciling into one, not two competing implementations, before it's upgraded to the full target Command Center spec. |
| Missing work | Decide which implementation is authoritative, retire or fold in the other, then add the full target card set (bid pipeline, schedule deadlines, risk alerts, etc. per Section A) |
| Acceptance test | Every card links to its real underlying workspace with correct filters |
| Nav | Sidebar "Overview" already points at `/dashboard`; `/dashboard/command-center` is currently reachable only by direct URL |

---

## Python takeoff engine (repo root, Railway-hosted)

Eight modules: `takeoff_api.py` (FastAPI entry point, 9 endpoints), `takeoff_extract.py` (deterministic PDF/DXF/IFC/XLSX extraction), `takeoff_parser.py` (streaming NDJSON validation), `takeoff_validator.py` (zero-hallucination integrity invariants + `DataIntegrityBreachException`), `enhanced_takeoff_system.py` (cost enrichment), `google_integration.py` (optional Sheets export, gracefully disables if unconfigured), `rate_limiting.py` (per-tenant quota), `cost_supabase.py` (cached cost-catalog client, never talks to Supabase directly). All compile cleanly; existing `test_takeoff_extract.py` passes (2 tests, 8 subtests). **Status: Complete & exposed** — this service has no frontend-reconciliation gap; it's correctly used only as a backend dependency of the Takeoff workspace above.

---

## Cross-cutting findings

1. **Role-based READ gating for financial data does not exist yet.** `lib/project-controls/permissions.ts`'s `canPerform()` always returns `true` for `action: "read"` regardless of resource category — only **writes** are gated by role (`financial`/`field`/`admin`). A `ClientView` or `Subcontractor` role can currently **read** financial data through any route that doesn't add its own extra check. This is a real gap against the master prompt's "hide financial values from restricted roles" requirement — see `ROLE_VISIBILITY_MATRIX.md`.
2. **Silent production fallbacks to localhost confirmed**: `PYTHON_API_URL` (3 call sites) and `ONYX_API_SECRET` (1 call site) both silently degrade instead of failing loudly when unset in production. Flagged for the environment-validation phase.
3. **Two duplicate Command Center implementations** (`/dashboard` vs `/dashboard/command-center`) — needs a decision, not a rewrite.
4. **Procurement is the clearest "backend + frontend exist, nothing connects them" case** — a one-line fix (add the tab), highest-value quick win.
5. **`estimate/[id]` update path** and a few other routes weren't independently re-verified against my own direct-build knowledge this pass — treat "Complete & exposed" labels outside Takeoff/Estimating (which I personally hardened this engagement) as based on static code reading, not live execution, until Phase 5's end-to-end verification.
