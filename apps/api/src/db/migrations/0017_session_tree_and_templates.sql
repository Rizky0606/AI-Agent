-- Migration 0017: Session Tree (Message Branching) and Prompt Templates (Sesi 27)

-- 1. Tree Branching columns for messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_active_branch BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS branch_index INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (conversation_id, parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_active ON messages (conversation_id, is_active_branch);

-- 2. Backfill linear messages tree structure for existing conversations
WITH ordered_messages AS (
  SELECT
    id,
    conversation_id,
    LAG(id) OVER (PARTITION BY conversation_id ORDER BY created_at ASC) as prev_id
  FROM messages
)
UPDATE messages m
SET
  parent_message_id = om.prev_id,
  is_active_branch = true,
  branch_index = 0
FROM ordered_messages om
WHERE m.id = om.id AND m.parent_message_id IS NULL AND om.prev_id IS NOT NULL;

-- 3. Prompt Templates table
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prompt_templates_user_idx ON prompt_templates (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_user_name_uq ON prompt_templates (user_id, name);
