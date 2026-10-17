-- Sesi 24: Deep Research Backend
-- Tables: research_runs, research_sources, research_evidence, research_reports

CREATE TABLE IF NOT EXISTS research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query text NOT NULL,
  scope text NOT NULL DEFAULT 'general',
  language varchar(16) NOT NULL DEFAULT 'id',
  depth varchar(32) NOT NULL DEFAULT 'standard',
  status varchar(32) NOT NULL DEFAULT 'queued',
  budget_config jsonb NOT NULL,
  budget_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan jsonb,
  checkpoint jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_runs_user_idx ON research_runs(user_id);
CREATE INDEX IF NOT EXISTS research_runs_project_idx ON research_runs(project_id);
CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status);
CREATE INDEX IF NOT EXISTS research_runs_created_idx ON research_runs(created_at);

CREATE TABLE IF NOT EXISTS research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  source_id varchar(32) NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  domain varchar(255) NOT NULL,
  credibility_score real NOT NULL DEFAULT 0.5,
  fetch_status varchar(32) NOT NULL DEFAULT 'pending',
  content_hash varchar(64),
  snippet text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_sources_run_idx ON research_sources(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_sources_run_source_uq ON research_sources(run_id, source_id);

CREATE TABLE IF NOT EXISTS research_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  source_id varchar(32) NOT NULL,
  statement text NOT NULL,
  claim_type varchar(32) NOT NULL DEFAULT 'sourced_fact',
  quote text,
  confidence real NOT NULL DEFAULT 0.8,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_evidence_run_idx ON research_evidence(run_id);
CREATE INDEX IF NOT EXISTS research_evidence_source_idx ON research_evidence(run_id, source_id);

CREATE TABLE IF NOT EXISTS research_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  title text NOT NULL,
  content_markdown text NOT NULL,
  confidence_by_section jsonb NOT NULL DEFAULT '{}'::jsonb,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS research_reports_run_uq ON research_reports(run_id);
