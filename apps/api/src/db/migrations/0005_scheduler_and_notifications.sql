CREATE TABLE IF NOT EXISTS schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  type varchar(32) NOT NULL,
  run_at timestamp with time zone,
  cron_expression varchar(100),
  timezone varchar(80) DEFAULT 'UTC' NOT NULL,
  status varchar(32) DEFAULT 'active' NOT NULL,
  missed_run_policy varchar(32) DEFAULT 'skip' NOT NULL,
  task_payload jsonb NOT NULL,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS schedules_user_idx ON schedules (user_id);
CREATE INDEX IF NOT EXISTS schedules_status_idx ON schedules (status);
CREATE INDEX IF NOT EXISTS schedules_next_run_idx ON schedules (next_run_at);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(64) NOT NULL,
  title varchar(255) NOT NULL,
  body text NOT NULL,
  data jsonb,
  delivery_state varchar(32) DEFAULT 'pending' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  deep_link varchar(255),
  last_error text,
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_delivery_state_idx ON notifications (delivery_state);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_uq ON notification_preferences (user_id);
