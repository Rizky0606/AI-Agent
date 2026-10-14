-- Push token per device.
--
-- The notification engine could only send FCM when the caller passed `deviceToken`, and no
-- production path knew any token: Android kept its FCM token in client state only. The token now
-- lives on the device row, so `dispatchNotification` can resolve every device of a user without
-- inventing one. Tokens are unique across the table (FCM hands one token per app install) and
-- nullable, because Windows devices have none.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token text;
CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token_uq ON devices(push_token)
  WHERE push_token IS NOT NULL;
