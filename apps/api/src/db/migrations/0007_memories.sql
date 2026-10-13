-- Durable memories. The Drizzle schema declared this table since the initial commit, but no
-- migration ever created it, so every write silently fell back to a per-process store and was
-- lost on the next API restart.

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  type varchar(32) NOT NULL,
  content text NOT NULL,
  scope varchar(120) NOT NULL,
  provenance varchar(64) NOT NULL,
  metadata jsonb,
  retention varchar(32) NOT NULL DEFAULT 'permanent',
  embedding vector(1536),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id);
CREATE INDEX IF NOT EXISTS memories_user_project_idx ON memories(user_id, project_id);
CREATE INDEX IF NOT EXISTS memories_user_type_idx ON memories(user_id, type);
CREATE INDEX IF NOT EXISTS memories_user_scope_idx ON memories(user_id, scope);
CREATE INDEX IF NOT EXISTS memories_user_created_idx ON memories(user_id, created_at);

ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_type_ck;
ALTER TABLE memories ADD CONSTRAINT memories_type_ck CHECK (
  type IN ('session', 'long-term', 'project', 'task', 'preference', 'knowledge', 'decision')
);

ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_retention_ck;
ALTER TABLE memories ADD CONSTRAINT memories_retention_ck CHECK (
  retention IN ('ephemeral', 'session', '30d', '90d', 'permanent')
);
