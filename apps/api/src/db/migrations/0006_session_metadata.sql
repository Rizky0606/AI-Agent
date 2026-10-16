ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode varchar(16) NOT NULL DEFAULT 'auto';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model varchar(200);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_id text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS parent_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS compacted_summary text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_event_id text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_mode_ck;
ALTER TABLE conversations ADD CONSTRAINT conversations_mode_ck CHECK (mode IN ('auto', 'fast', 'coding', 'complex', 'research'));
CREATE INDEX IF NOT EXISTS conversations_parent_idx ON conversations(parent_conversation_id);
