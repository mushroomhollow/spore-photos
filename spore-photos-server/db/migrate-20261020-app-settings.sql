-- Migration: server-wide application settings table
-- Date: 2026-10-20
--
-- Backs Settings > Storage (photos root override) and the Unsorted import.
-- Purely additive: creates an empty key/value table. With no 'photos_root' row
-- present, config.picturesRoot still resolves from the PICTURES_ROOT env var,
-- so applying this does not change where photos live.

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- app_settings is created by the deploying database user, which owns it and so
-- already holds all privileges on it.
