ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS trace_id varchar(128);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS decision varchar(32);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  resource varchar(255) NOT NULL,
  scope varchar(120) NOT NULL,
  risk_level varchar(32) NOT NULL,
  consequence text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  decision_reason text,
  approver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  fingerprint varchar(128) NOT NULL,
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_status_ck CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT approvals_risk_level_ck CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

CREATE INDEX IF NOT EXISTS approvals_user_status_idx ON approvals(user_id, status);
CREATE INDEX IF NOT EXISTS approvals_task_idx ON approvals(task_id);
CREATE INDEX IF NOT EXISTS approvals_fingerprint_idx ON approvals(fingerprint);
