-- Production follow-up for the report_runs.project_id FK advisor. The index
-- is also present in the idempotent report_runs replay files; keeping this
-- migration preserves parity with Supabase's applied migration ledger.

create index if not exists idx_report_runs_project_id
  on public.report_runs(project_id);
