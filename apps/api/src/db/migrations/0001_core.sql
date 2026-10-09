CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_uq UNIQUE (email)
);
CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL, platform varchar(32) NOT NULL, public_key text,
  last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_user_name_uq UNIQUE (user_id, name)
);
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  replaced_by_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_user_name_uq UNIQUE (user_id, name), CONSTRAINT projects_scope_uq UNIQUE (id, user_id)
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, title varchar(200), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_scope_uq UNIQUE (id, user_id),
  CONSTRAINT conversations_project_scope_fk FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL, role varchar(32) NOT NULL, content text NOT NULL, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_conversation_scope_fk FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE CASCADE,
  CONSTRAINT messages_role_ck CHECK (role IN ('system', 'user', 'assistant', 'tool'))
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, status varchar(32) NOT NULL, kind varchar(80) NOT NULL, payload jsonb NOT NULL,
  idempotency_key varchar(128), lease_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_project_scope_fk FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT tasks_user_idempotency_uq UNIQUE (user_id, idempotency_key),
  CONSTRAINT tasks_status_ck CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
CREATE TABLE task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type varchar(80) NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_events_task_scope_fk FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE
);
CREATE TABLE model_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL UNIQUE, base_url varchar(500) NOT NULL,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  model varchar(200) NOT NULL, capabilities jsonb NOT NULL, context_window integer, cost_metadata jsonb,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_configs_provider_model_uq UNIQUE (provider_id, model)
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL, action varchar(120) NOT NULL,
  resource_type varchar(80) NOT NULL, resource_id uuid, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices(user_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX projects_user_idx ON projects(user_id);
CREATE INDEX conversations_scope_idx ON conversations(user_id, project_id);
CREATE INDEX messages_scope_idx ON messages(user_id, conversation_id);
CREATE INDEX messages_created_idx ON messages(conversation_id, created_at);
CREATE INDEX tasks_scope_status_idx ON tasks(user_id, project_id, status);
CREATE INDEX task_events_scope_idx ON task_events(user_id, task_id, created_at);
CREATE INDEX model_configs_enabled_idx ON model_configs(enabled);
CREATE INDEX audit_logs_user_created_idx ON audit_logs(user_id, created_at);
CREATE INDEX audit_logs_project_created_idx ON audit_logs(project_id, created_at);
