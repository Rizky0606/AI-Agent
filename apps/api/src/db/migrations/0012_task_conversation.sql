-- A task can be launched from a chat conversation. The link is a plain nullable FK:
-- tasks created from the Tasks screen stay NULL, and a deleted conversation detaches
-- its tasks (SET NULL) rather than deleting them.
ALTER TABLE tasks
  ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX tasks_conversation_idx ON tasks (user_id, conversation_id);
