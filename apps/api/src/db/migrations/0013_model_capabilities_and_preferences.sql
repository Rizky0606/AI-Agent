ALTER TABLE users ADD COLUMN IF NOT EXISTS default_model varchar(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_mode varchar(16) DEFAULT 'auto';

ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS capability_details jsonb;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS is_recommended boolean NOT NULL DEFAULT false;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS availability_status varchar(32) NOT NULL DEFAULT 'available';
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS last_latency_ms integer;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS model_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode varchar(32) NOT NULL,
  model_name varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_routing_policies_mode_uq UNIQUE (mode)
);

CREATE INDEX IF NOT EXISTS model_routing_policies_mode_idx ON model_routing_policies(mode);
