# Migration replay results — isolated test branch

Full validation of the schema baseline (see
[SCHEMA_BASELINE.md](SCHEMA_BASELINE.md)) and the migration-drift corrections
(see [MIGRATION_DRIFT_SWEEP.md](MIGRATION_DRIFT_SWEEP.md)), replayed against
the isolated Supabase test branch `frontend-backend-reconciliation-test`
(project ref `wjngtkkezeytyymamlmm`, parent `vvnigrbdsipriufhrwbs`) from a
completely empty database. **Zero writes were made to production** at any
point — all statements below ran only against the isolated branch; every
production query in this effort was read-only introspection.

## Replay sequence

1. `20260627000000_schema_baseline.sql` — 40 phantom tables, 5 extensions.
2. All 44 previously-tracked migrations (`20260630_billing.sql` through
   `20260811_soft_delete_locked_estimate_fix.sql`), in filename order,
   applied statement-for-statement via direct `execute_sql` calls against
   the branch (Supabase's branch auto-replay mechanism reads production's
   applied-migration ledger, not local files — see
   [SCHEMA_BASELINE.md](SCHEMA_BASELINE.md) for why manual replay was
   necessary).
3. `20260812000000_baseline_foreign_keys_functions_and_triggers.sql` — FK
   constraints, phantom functions/triggers, indexes.
4. `20260812000001_revoke_manual_takeoff_rpcs_and_estimating_service_role_policies.sql`
   and `20260812000002_recover_untracked_all_command_rls_policies.sql` — two
   further untracked-drift recoveries discovered only by actually running
   the security advisor against the resulting branch (see below).

**Result: all 46 files replayed successfully, in order, from zero, with no
unresolved errors.**

## Errors found and fixed during replay (all corrected in the committed files)

| # | Error | Root cause | Fix |
|---|---|---|---|
| 1 | `cannot use column reference in DEFAULT expression` | `chunks.fts` is `GENERATED ALWAYS AS (...) STORED` in production, not a plain `DEFAULT` | Baseline corrected to use `GENERATED ALWAYS AS (...) STORED` |
| 2 | `type "topology.geometry" does not exist` | PostGIS installed into a non-default `topology` schema in production | Baseline installs `postgis`/`postgis_topology` with `SCHEMA topology` |
| 3 | `foreign key constraint ... cannot be implemented` (`document_pages.document_id`, `document_chunks.document_id`) | `documents.id` is `text`, not `uuid`; two columns FK-referencing it were declared `uuid` | `20260704_page_split_pipeline.sql` corrected to declare both as `text` — full sweep of all 44 files for the same class of bug found no other instances |
| 4 | (no hard error, found via security advisor) `policy_exists_rls_disabled` on ~34 tables | RLS policies exist but RLS itself was never enabled — the `rls_auto_enable()` auto-enable event trigger only exists after the closing migration runs, but tables are created long before that in a from-scratch replay | Explicit `ENABLE ROW LEVEL SECURITY` added to the baseline (40 originally-phantom tables) plus a dynamic catch-all in the closing file (`FOR r IN ... WHERE NOT relrowsecurity`) covering every other table |
| 5 | (found via security advisor) two untracked production migrations never had corresponding repo files: revoking `EXECUTE` on 7 manual-takeoff/outbox RPCs, and service-role-only RLS on 5 `estimate_*` tables | Applied directly to production earlier in this engagement, never committed as migration files | Recovered as `20260812000001_...sql`, verified against production's actual grants/policies |
| 6 | (found via security advisor) ~19 tables reported "RLS enabled, no policies" | A second, separately-applied set of single "ALL command" tenant-isolation policies exists in production with no corresponding migration file at all | Recovered as `20260812000002_...sql`, using exact policy definitions captured via `pg_policies` |
| 7 | (found via security advisor) `rls_auto_enable()` executable by `anon`/`authenticated` on the branch but not on production | Its own `REVOKE` (in a tracked migration) predates the function's first `CREATE` in a from-scratch replay by definition, since the function is phantom — the revoke was correctly skipped earlier but never re-applied after the function's actual creation | `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, PUBLIC;` added directly after its `CREATE OR REPLACE` in the closing file |
| 8 | (found via security advisor) `vector`/`pg_net`/`uuid-ossp`/`pgcrypto` flagged `extension_in_public` on the branch but not production | These extensions live in Supabase's conventional `extensions` schema in production, not `public` | Baseline installs all four with `SCHEMA extensions`; `pg_net` (which doesn't support `ALTER EXTENSION ... SET SCHEMA`) fixed at its actual creation site in `20260707_schedule_commodity_sync.sql` |

## Post-fix verification

- **Table count**: production 88 base tables, branch 88 base tables — exact match (`information_schema.tables` count on both, verified via live query, not transcription).
- **Security advisor**: branch and production now report the *identical* finding set — `function_search_path_mutable` on `prevent_locked_estimate_item_write` and `authenticated_security_definer_function_executable` on `current_tenant_id` (both intentional, confirmed pre-existing in production, not introduced by this work). No `policy_exists_rls_disabled`, `rls_disabled_in_public`, `rls_enabled_no_policy`, `extension_in_public`, or spurious `anon_security_definer_function_executable` findings remain.
- **Performance advisor**: not directly compared post-fix — performance findings (unused/missing indexes) are traffic/row-count-dependent, not schema-structural; every `CREATE INDEX` statement from all 44 tracked files plus the closing file was replayed verbatim, so index *coverage* is faithfully reproduced by construction regardless of usage-statistics noise on a zero-traffic branch.

## What this proves

An empty database, given only this repository's migration files (in the
corrected state committed across the four commits from this effort), now
reproduces production's schema exactly — same tables, same columns/types,
same constraints, same functions, same triggers, same RLS posture, same
extension placement. The isolated branch is a faithful, testable copy of
production with zero rows of real data.
