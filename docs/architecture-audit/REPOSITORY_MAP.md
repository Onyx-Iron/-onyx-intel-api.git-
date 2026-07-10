# Repository Map

Audit date: this session. Read-only investigation, no code changes.

## Authoritative structure

| Path | Role | Deployed to |
|---|---|---|
| `portal/` | Next.js 16 app (App Router). Frontend + all API routes + Supabase client code. | Vercel — `.vercel/project.json` at repo root and inside `portal/` both point to identical `projectId: prj_m6NHGRFw9zUeRMpT5LgjFg9Oc184` |
| `takeoff_api.py`, `takeoff_extract.py`, `takeoff_parser.py`, `takeoff_validator.py`, `rate_limiting.py`, `cost_supabase.py`, `google_integration.py`, `enhanced_takeoff_system.py` (repo root) | Python FastAPI takeoff/estimating service | Railway — `Procfile:1` and `nixpacks.toml:7-8` both run `uvicorn takeoff_api:app --host 0.0.0.0 --port $PORT --workers 2` |
| `portal/supabase/migrations/` | **Authoritative** schema history (40+ dated files, `YYYYMMDD_description.sql`) | Supabase Postgres, project `vvnigrbdsipriufhrwbs` |
| `portal/supabase/functions/` | 4 Edge Functions (Deno) | Supabase Edge Functions |

## portal/ second-level structure

- `app/` — App Router: `admin/`, `api/` (121 route.ts files), `dashboard/`, `onboarding/`, `qa-dashboard/`, `sign-in/`, `sign-up/`, `public/`
- `components/` — ~30 feature directories (agents, ai, billing, contacts, cut-fill, dailylog, documents, earthwork, estimate, google, invoicing, marketing, procurement, project-controls, staff, takeoff, ui, etc.)
- `lib/` — domain logic: `activity.ts`, `audit.ts`, `http.ts`, `pagination.ts`, `python-api.ts`, `validation.ts`, plus `agents/`, `ai/`, `billing/`, `cad/`, `cost/`, `cutfill/`, `documents/`, `estimating/`, `google/`, `marketing/`, `math/`, `parse/`, `project-controls/`, `supabase/`, `takeoff/`
- `supabase/functions/` and `supabase/migrations/` — see above

## Dead / legacy artifacts (confirmed, not yet cleaned up)

| Artifact | Status |
|---|---|
| `public/index.html` + `public/takeoff-grid.js` (repo root) | **Dead legacy prototype.** Standalone static HTML/JS single-page app predating the Next.js UI (`<title>Onyx Intel — Plan Takeoff</title>`, same dark theme). Not referenced by any deployment config (`Procfile`, `nixpacks.toml`, Vercel config). Confirmed unreferenced/unserved. |
| `schema.sql` (repo root, 8160 bytes) | Legacy/duplicate schema file, predates `portal/supabase/migrations/`. Not tracked as an applied migration. |
| `portal/supabase-schema.sql` | Same class of risk — loose, untracked schema file. |
| `portal/supabase-migration-v2.sql` through `v9.sql` (8 files) | Loose, hand-applied-to-production SQL files sitting outside the tracked migrations directory. **This exact pattern already caused a real incident**: `v7` defined columns (`estimate_items.source_takeoff_id` etc.) that were never actually applied to the live database, causing a hard production error ("column estimate_items.source_takeoff_id does not exist") until discovered and fixed manually this session. The other 7 files carry the identical unverified-application risk. |
| `lib/agents/` (repo root, **empty**) | Vestigial — distinct from the real, populated `portal/lib/agents/`. Leftover from an earlier layout. |
| `.agents/skills` (empty) | Empty, no content. |
| `portal/.env.local.bak` | Stray backup of the env file sitting in the working tree (gitignored, minor housekeeping debt only). |
| `portal/server.err.log`, `portal/server.out.log` | Stray log files checked into the working tree, not build artifacts that should persist. |

**No duplicate route/component pairs were found serving the same purpose within the live `portal/app` or `portal/components` trees** — the duplication risk is entirely root-vs-portal legacy SQL/HTML artifacts, not within the live application code itself.

## Migration tracking gap

Supabase's own `list_migrations` reports **53 applied migrations** (versioned `YYYYMMDDHHMMSS`); the repo's `portal/supabase/migrations/` directory contains **41 files** (dated `YYYYMMDD`, no time component). The two lists cannot be diffed by filename (different naming schemes), but the count mismatch alone (53 tracked vs. 41 files) means **at least ~12 schema changes were applied to the live database with no corresponding file checked into the repository.** Combined with the 9 loose `supabase-migration-v*.sql`/`schema.sql` files above, this is a systemic gap: there is no single source of truth that reliably represents "what the live schema actually is" by reading the repo alone.

## Test files (real, non-`node_modules`)

- `portal/lib/project-controls/schema.test.ts`
- `portal/lib/estimating/takeoff-import.test.ts`
- `portal/lib/estimating/estimate-qc.test.ts`
- `portal/lib/ai/grounding.test.ts`
- `portal/lib/google/scopes.test.ts`
- `portal/lib/documents/revisions.test.ts`
- `test_takeoff_extract.py` (repo root, Python)

7 real test files total, against 121 API route files + ~30 component directories + the full Python takeoff engine. See `ACCEPTANCE_TEST_MATRIX.md` for workflow-level coverage gaps.

## CI/CD

No `.github/workflows/` directory exists. **There is no automated test gate between `git push` and production deployment** — Vercel's auto-deploy-on-push means any code that passes a local `git push` reaches production regardless of whether the 7 existing tests (or a manual `tsc`/`eslint` pass) were run.
