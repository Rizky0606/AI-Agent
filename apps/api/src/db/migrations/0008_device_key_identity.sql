-- Device identity becomes the public key.
--
-- `devices_user_name_uq` assumed a device is identified by (user, name), which was never true:
-- the Windows agent derived its name from the hostname, so a re-installed agent reused the name,
-- and two machines can legitimately share a hostname. Identity now comes from a P-256 key that the
-- agent proves possession of at the handshake, so the name is a label and the key must be unique
-- across the whole table — otherwise the same key could claim devices under two accounts.

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_user_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS devices_public_key_uq ON devices(public_key)
  WHERE public_key IS NOT NULL;
