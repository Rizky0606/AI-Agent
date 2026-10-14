-- Federated sign-in. A user who only ever signs in through a provider has no password, so
-- `password_hash` becomes optional; `user_identities` maps the (provider, subject) pair the
-- provider hands us to the local user and is the lookup key on every later sign-in.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  subject varchar(255) NOT NULL,
  email varchar(320) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);
