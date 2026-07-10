# Contact & Company Audit

(Companion to the Contact/Company section in ESTIMATING_AUDIT.md — reproduced standalone per the required document list, same underlying findings.)

## Manual contact creation

`app/api/contacts/route.ts` — POST inserts directly into `contacts`: `tenant_id, name, company, role, email, phone, notes, project_id`. `company` is a free-text string on the contact row itself. `project_id` is a single FK — **no separate `project_contacts` relationship table exists**, so a contact's role is tied to at most one project at a time, contradicting the requirement that "project-specific contact roles must exist on relationship records, not only on the master contact."

## Company creation

`app/api/companies/route.ts`'s `ensureCompany()` — looks up **at most one row per tenant** (DB-enforced via `UNIQUE(tenant_id)`), creates exactly one if none exists, named after the tenant/org (`"My Workspace"` fallback). No `POST` handler exists to create *additional* company rows, and no listing/search endpoint for multiple companies. **Confirmed: `companies` is the tenant's own firm/billing profile, not a CRM table of external companies** (GCs, subs, owners, lenders). That entity type doesn't exist in the schema at all.

## Project linking

Only via the single `contacts.project_id` FK, filterable in the GET list endpoint. No company-to-project relationship table exists either.

## Document extraction

`/api/contacts/parse` — real AI extraction from **pasted text only** (not documents directly), explicit comment confirms it returns candidates for human review and does not auto-save. **Confirmed standalone**: the only caller found repo-wide is the manual "paste text → extract" UI flow (`ContactsTab.tsx`). No document-upload route, page-processor, page-split-worker, or page-takeoff-worker Edge Function calls this endpoint or extracts contacts automatically from an uploaded plan set — despite plan title blocks, cover sheets, and specification front matter being the primary spec-intended source.

## Duplicate detection

**Confirmed absent.** The POST handler's only pre-insert checks are non-empty `name` and valid-UUID `project_id`. There is no query for an existing contact by name/email/phone before insert. It is trivially possible, by code inspection, to create the exact same contact twice with zero warning.

## Verification / merge behavior

No `verification_status`/`confidence`/`last_verified_date` fields exist on the live `contacts` schema. **No merge functionality exists anywhere** — a repo-wide case-insensitive grep for "merge" returns exactly 4 hits, none related to contacts or companies (pipe-geometry merging, a cost-catalog-merge code comment, and two unrelated routes).

## Source preservation

None beyond the free-text `notes` field. No equivalent to `estimate_items`' `source_takeoff_id`/`source_fingerprint`/`quantity_basis` provenance chain exists for contacts — there is no way to trace a contact record back to the document/page/extraction method that produced it.

## Project directory / search / communication history

- No dedicated "project directory" view beyond the `project_id` filter on the contacts list.
- No contact/company text-search endpoint found (only pagination).
- No communication-history table/route associated with contacts — the closest analog is the generic project activity feed's "Contact created" log line, not a structured communication record.

## Duplicate contact systems

None found — there is exactly one `contacts` table and one flow. The gap here is not duplication but absence: no relationship table, no dedup, no merge, no source traceability, and no document-pipeline wiring — all foundational per the product spec's Domain 2 requirements, none of it built beyond a flat CRUD seed.
