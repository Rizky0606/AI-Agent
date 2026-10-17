-- Sesi 26: Compare Multi-Model
-- Tables: compare_runs, compare_results

CREATE TABLE IF NOT EXISTS compare_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  blind_mode boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'running',
  winner_model_id varchar(128),
  revealed boolean NOT NULL DEFAULT false,
  revealed_at timestamptz,
  synthesis_status varchar(32) NOT NULL DEFAULT 'none',
  synthesis_model varchar(128),
  synthesis_content text,
  synthesis_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_budget integer NOT NULL DEFAULT 4000,
  total_tokens_used integer NOT NULL DEFAULT 0,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compare_runs_user_idx ON compare_runs(user_id);
CREATE INDEX IF NOT EXISTS compare_runs_project_idx ON compare_runs(project_id);
CREATE INDEX IF NOT EXISTS compare_runs_status_idx ON compare_runs(status);
CREATE INDEX IF NOT EXISTS compare_runs_created_idx ON compare_runs(created_at);

CREATE TABLE IF NOT EXISTS compare_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES compare_runs(id) ON DELETE CASCADE,
  model_id varchar(128) NOT NULL,
  model_alias varchar(32) NOT NULL,
  column_index integer NOT NULL,
  content text NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'pending',
  error text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost real,
  is_winner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compare_results_run_idx ON compare_results(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS compare_results_run_col_uq ON compare_results(run_id, column_index);
