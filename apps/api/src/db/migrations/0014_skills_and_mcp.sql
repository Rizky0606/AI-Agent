-- Sesi 14: Skill Manager dan MCP Manager

ALTER TABLE skills ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS last_outcome varchar(32);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS project_skills (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_name varchar(120) NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, skill_name)
);

CREATE INDEX IF NOT EXISTS project_skills_project_idx ON project_skills(project_id);
CREATE INDEX IF NOT EXISTS project_skills_skill_name_idx ON project_skills(skill_name);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id varchar(120) PRIMARY KEY,
  name varchar(200) NOT NULL,
  transport varchar(32) NOT NULL,
  command varchar(255),
  args jsonb,
  url varchar(500),
  allowed_capabilities jsonb NOT NULL,
  risk_level varchar(32) NOT NULL DEFAULT 'MEDIUM',
  status varchar(32) NOT NULL DEFAULT 'connected',
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  is_approved boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_servers_status_idx ON mcp_servers(status);
CREATE INDEX IF NOT EXISTS mcp_servers_transport_idx ON mcp_servers(transport);

CREATE TABLE IF NOT EXISTS mcp_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id varchar(120) NOT NULL,
  tool_name varchar(120) NOT NULL,
  arguments jsonb,
  duration_ms integer NOT NULL,
  status varchar(32) NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_call_logs_server_tool_idx ON mcp_call_logs(server_id, tool_name);
CREATE INDEX IF NOT EXISTS mcp_call_logs_created_idx ON mcp_call_logs(created_at);
