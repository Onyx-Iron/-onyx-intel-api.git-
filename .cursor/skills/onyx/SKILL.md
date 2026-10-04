---
name: onyx
description: Use when working in the Onyx Intel construction app — navigation, project sections, AI project skills, or where a user should go to use a live function.
---

# Onyx Intel

Onyx Intel is the Onyx & Iron construction workspace in `portal/`. A project is the root record. Company-wide pages roll up many projects. Do not invent budget, commitment, or forecast tables that are not in the schema.

## Jump anywhere

Users open any working screen with **Ctrl K** or **⌘ K** (sidebar **Jump to a function**, or the mobile search icon). Home search also lists matching functions before record results.

Project screens use `/dashboard/projects/{id}?phase={slug}&tab={id}`. Slugs and tabs live in `portal/lib/navigation/project-sections.ts`.

| Section | Slug | Tabs |
|---|---|---|
| Overview | `overview` | `summary`, `risk` |
| Documents | `documents` | `documents` |
| Takeoff | `takeoff` | `takeoff`, `cutfill` |
| Estimate & Budget | `estimate` | `estimates`, `budget`, `selections` |
| Schedule | `schedule` | `scheduling` (list, timeline, 21-day lookahead) |
| Project Controls | `controls` | `controls` (RFIs, submittals, change orders, change events, record links) |
| Procurement | `procurement` | `procurement`, `materials`, `equipment`, `subs` |
| Financials | `financials` | `ar`, `ap`, `open`, `closed`, `lien-waivers`, `pay-apps` |
| Field | `field` | `daily-log`, `weekly-log`, `todo`, `staff`, `time`, `meetings` |
| Closeout | `closeout` | `punchlist`, `co`, `inspections`, `final-docs` |

Company pages: Home, Projects, Bid Board (`/dashboard/preconstruction`), Reports, AI Workforce (`/dashboard/agents/pending`), Project Management, Takeoff, Estimating, Documents, Contacts, Price Book, Procurement, Financials, Civil Intelligence, Marketing, and Settings (connections, team, billing, cost overrides).

## AI project skills

With a project selected, Home **AI Command** calls `/api/ai/chat` in `agentic` mode. Skills are read-only and implemented in `portal/lib/ai/project-skills.ts`. They cannot create, approve, award, or delete records. Point the user at `open_in_app`.

Skills: `search_project_docs`, `get_related_specs`, `get_documents`, `get_open_rfis`, `get_submittals`, `get_change_orders`, `get_schedule_tasks`, `get_project_data`, `get_estimate_summary`, `get_invoices`, `get_lien_waivers`, `get_punch_list`, `get_daily_logs`, `get_weekly_logs`, `get_todos`, `get_staff`, `get_procurement`, `get_contacts`, `get_takeoff_items`, `get_project_links`, `get_sheet_pins`, `get_budget_summary`, `get_pay_applications`, `get_lookahead`, `get_production_quantities`, `list_workspace_sections`.

Financial amounts (budget, invoice, change order, estimate total, PO total, lien amount) are null when `financials_redacted` is true. Staff pay rates are never returned. If a skill returns no rows, say so.

Portfolio chat (no active project) stays in assist mode and only sees the dashboard summary.
