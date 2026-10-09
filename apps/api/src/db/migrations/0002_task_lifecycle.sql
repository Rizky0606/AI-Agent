ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_ck;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_ck CHECK (
  status IN ('queued', 'planning', 'running', 'waiting_approval', 'paused', 'failed', 'completed', 'cancelled')
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkpoint jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS artifacts jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
