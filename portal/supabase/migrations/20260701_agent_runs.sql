-- agent_runs: persisted history of in-app background agent executions (idempotent)

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid,
  agent_kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_kind text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued';
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_agent_kind_check'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_agent_kind_check
      CHECK (agent_kind IN ('risk_scout', 'daily_log_assistant', 'tenant_guard'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_check'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_status_check
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_project_kind_created
  ON agent_runs(tenant_id, project_id, agent_kind, created_at DESC);
