-- Migration: add ACS device capability fields to intercoms table
-- Run on production after git pull:
--   psql "$DATABASE_URL" -f lib/db/migrations/0010_add_acs_fields_to_intercoms.sql

ALTER TABLE intercoms
  ADD COLUMN IF NOT EXISTS door_count       INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lock_type        TEXT,
  ADD COLUMN IF NOT EXISTS pin_support      BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS schedule_support BOOLEAN DEFAULT FALSE;
