-- Client tokens: an authorised client is identified by a server-issued token,
-- not by a client-generated device id or by its IP address.
--
-- Idempotent: the grandfathering UPDATE only runs when the columns are created,
-- so re-running migrations never re-authorises a device that was revoked.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'client_token_hash'
  ) THEN
    ALTER TABLE devices ADD COLUMN client_token_hash TEXT;
    ALTER TABLE devices ADD COLUMN authorized BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE devices ADD COLUMN authorized_at TIMESTAMPTZ;

    -- Devices that existed before this migration have already been vouched for
    -- by an access code or a password login, so keep them working: they may use
    -- the password form once, which issues their token.
    UPDATE devices SET authorized = true, authorized_at = NOW();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_devices_client_token_hash
  ON devices (client_token_hash);