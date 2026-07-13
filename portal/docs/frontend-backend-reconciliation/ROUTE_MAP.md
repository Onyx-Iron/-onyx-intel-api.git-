# Route Map

Concise route → domain → status index. Full per-route detail (methods, tables, auth notes) is in `CAPABILITY_MATRIX.md`; this file is the quick-reference cross-index.

| Domain | Route prefix | Route count | Status |
|---|---|---|---|
| Projects | `/api/projects*` | 3 | Complete & exposed |
| Documents | `/api/documents*`, `/api/parse/*`, `/api/generated-docs` | 8 | Complete but buried |
| Takeoff canvas + extraction | `/api/takeoff/*` | 16 | Complete & exposed (project-level) |
| Estimating | `/api/estimate*` | 13 | Complete & exposed (project-level) |
| Change Orders | `/api/change-orders*` | 2 | **Broken (503 stub)** |
| RFIs / Submittals | `/api/rfis*`, `/api/submittals*` | 6 | Complete but buried |
| Daily/Weekly Logs, Schedule, Punch, To-Do, Staff | `/api/daily-logs*`, `/api/weekly-logs*`, `/api/schedule*`, `/api/punch-list*`, `/api/todo-items*`, `/api/staff*` | 6 | Complete but buried |
| Invoicing / Lien Waivers | `/api/invoices*`, `/api/lien-waivers*` | 4 | Partially connected (no budget/actuals model) |
| Procurement | `/api/procurement/*`, `/api/public/procurement-request/*`, `/api/material-vendors*`, `/api/equipment-suppliers*` | 5 | **Complete, orphaned frontend** |
| Contacts & Companies | `/api/contacts*`, `/api/companies`, `/api/staff*` | 5 | Complete & exposed |
| Civil / Earthwork | `/api/earthwork/*`, `/api/cut-fill/*` | 8 | Complete but buried |
| AI / Agents | `/api/ai/*`, `/api/agents/*` | 8 | Complete but buried |
| Marketing | `/api/marketing/*` | 3 | Complete, orphaned frontend |
| Billing / Admin | `/api/billing/*`, `/api/admin/*`, `/api/team/*` | 5 | Complete, orphaned frontend |
| Google Integration | `/api/google/*` | 9 | Complete & exposed |
| Cost Catalog | `/api/cost-catalog/*` | 6 | Complete & exposed (Price Book) / buried (overrides) |
| Command Center / dashboards | `/api/dashboard`, `/api/overview`, `/api/status-report`, `/api/search`, `/api/activity`, `/api/audit-logs` | 5 | Duplicate frontend implementations |
| Internal / Outbox | `/api/internal/outbox/*` | 2 | Complete & exposed (server-to-server, no UI) |
| Co-inspections | `/api/co-inspections*` | 2 | Complete but buried |
| Project controls / role | `/api/project-controls/role` | 1 | Complete & exposed |

**Total:** 130 route files (confirmed by direct count), 19 domains.
