-- Sesi 28: Scheduled Task Briefs and Skill Proposals
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_brief text;

CREATE TABLE IF NOT EXISTS skill_proposals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  skill_name varchar(120) NOT NULL,
  title varchar(200) NOT NULL,
  description text NOT NULL,
  proposed_manifest jsonb NOT NULL,
  prompt_instructions text,
  change_type varchar(32) DEFAULT 'new_skill' NOT NULL,
  target_skill_name varchar(120),
  diff text,
  status varchar(32) DEFAULT 'pending' NOT NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS skill_proposals_user_idx ON skill_proposals (user_id);
CREATE INDEX IF NOT EXISTS skill_proposals_status_idx ON skill_proposals (status);
CREATE INDEX IF NOT EXISTS skill_proposals_skill_name_idx ON skill_proposals (skill_name);
