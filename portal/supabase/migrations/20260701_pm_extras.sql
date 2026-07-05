-- Weekly logs (AI-summarized weekly project reports) and to-do items
-- Idempotent; tenant + project scoped.

CREATE TABLE IF NOT EXISTS weekly_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  schedule_status text,
  budget_status text,
  milestones_completed text,
  upcoming_milestones text,
  open_issues text,
  decisions_needed text,
  summary text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_logs_week_range CHECK (week_end >= week_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_logs_tenant_project_week_uniq
  ON weekly_logs (tenant_id, project_id, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_logs_tenant_project
  ON weekly_logs (tenant_id, project_id, week_start DESC);

CREATE TABLE IF NOT EXISTS todo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  notes text,
  due_date date,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  assignee text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT todo_items_status_chk CHECK (status IN ('open', 'in_progress', 'done')),
  CONSTRAINT todo_items_priority_chk CHECK (priority IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_todo_items_tenant_project
  ON todo_items (tenant_id, project_id, status, due_date);
