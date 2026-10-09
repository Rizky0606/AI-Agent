CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE,
  version varchar(32) NOT NULL,
  description text NOT NULL,
  manifest jsonb NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  scope varchar(80) NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skills_name_idx ON skills(name);
CREATE INDEX IF NOT EXISTS skills_is_enabled_idx ON skills(is_enabled);

CREATE TABLE IF NOT EXISTS skill_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name varchar(120) NOT NULL,
  version varchar(32) NOT NULL,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_revisions_name_idx ON skill_revisions(skill_name);
CREATE INDEX IF NOT EXISTS skill_revisions_name_version_idx ON skill_revisions(skill_name, version);
