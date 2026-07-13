# Target Information Architecture

Proposed navigation restructuring based on `CAPABILITY_MATRIX.md`. This is the **design** for Phases 2–4; implementation happens in those phases, not this one.

## Global sidebar (replaces the current 5-link Sidebar)

| Workspace | Current state | Target action |
|---|---|---|
| Command Center | `/dashboard` exists; `/dashboard/command-center` is a duplicate | Reconcile the two into one, then expand card set |
| Projects | Exists, correct | No change |
| Preconstruction | Doesn't exist as a company-wide view | New — aggregates bid pipeline across projects |
| Takeoff | Project-level only | New global roll-up |
| Estimating | Project-level only | New global roll-up |
| Project Management | Scattered across project phases | New global roll-up (RFIs/submittals/schedule/logs/punch/staff) |
| Financials | Invoicing exists; budget/commitment/actuals model does NOT exist | Expose what's real; explicitly label the rest "Not yet available" — do not fabricate |
| Procurement | Backend complete, frontend orphaned | Add project-tab link (quick win) + global workspace |
| Contacts & Companies | Exists, correct | Expand to vendors/subs/roles view |
| Documents | Exists but no per-file processing status | Add status workspace |
| Civil Intelligence | Project-level only, no global view | New |
| AI Workforce | `/dashboard/agents/pending` orphaned | New global workspace |
| Marketing | `/dashboard/marketing` orphaned | Add to Sidebar |
| Reports | Doesn't exist | New |
| Settings & Administration | Billing/team/cost-overrides pages exist, zero nav path | New Settings submenu |

## Project workspace (replaces 5-phase / ~21-subtab structure)

Target 10 primary sections, secondary tabs only within a section:

1. Overview
2. Documents
3. Takeoff
4. Estimate & Budget
5. Schedule
6. Project Controls *(RFIs, Submittals, Change Orders)*
7. Procurement *(Materials, Equipment, Vendor Bids, POs — currently has NO tab at all)*
8. Financials *(AR, AP, Invoices, Lien Waivers)*
9. Field *(Daily Logs, Weekly Logs, To-Do, Staff)*
10. Closeout *(Punch List, CO, Final Docs)*

This recomposes existing tab components into fewer top-level sections — it does not rewrite the underlying `*Tab.tsx` components, which already work.

## Role-based visibility

See `ROLE_VISIBILITY_MATRIX.md` for the underlying permission model and the read-gating gap that must be closed before Financials can be safely restricted to authorized roles only.

## Experimental labeling

Modules with real backend but genuinely unverified end-to-end status (Change Orders — confirmed broken; AI Workforce approval flows; Civil Intelligence accuracy claims) get an explicit "Experimental" or "Unavailable" badge rather than being presented as production-ready.
