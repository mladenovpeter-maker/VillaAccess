-- 0017_add_smart_locks.sql
--
-- Phase 1 of Tuya smart-lock integration: ADDITIVE smart_locks table.
--
-- This migration introduces a new table to track Wi-Fi smart locks (Tuya
-- ecosystem in v1). It does NOT touch any existing table, column, index
-- or constraint. No row migration. Reversible by DROP TABLE smart_locks.
--
-- Constraints / business rules:
--   * One lock per villa — enforced by UNIQUE INDEX on villa_id (partial
--     uniqueness via standard UNIQUE: NULLs are allowed multiple times,
--     so unassigned locks don't conflict).
--   * villa_id ON DELETE SET NULL — deleting a villa orphans the lock
--     row rather than cascading, matching cameras/intercoms behaviour.
--   * Tuya creds (Access ID/Secret/region) are deployment-wide and live
--     in ENV vars, NOT per-row. Only the per-device tuya_device_id is
--     stored here.
--
-- Idempotent: safe to re-run on prod where the table / enum may already
-- exist (IF NOT EXISTS + DO blocks for enums).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smart_lock_status') THEN
    CREATE TYPE smart_lock_status AS ENUM ('online', 'offline', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smart_lock_protocol') THEN
    CREATE TYPE smart_lock_protocol AS ENUM ('tuya');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS smart_locks (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  villa_id               text REFERENCES villas(id) ON DELETE SET NULL,
  protocol               smart_lock_protocol NOT NULL DEFAULT 'tuya',
  tuya_device_id         text,
  status                 smart_lock_status NOT NULL DEFAULT 'offline',
  battery_pct            integer,
  last_seen              timestamp,
  last_status_check      timestamp,
  last_status_latency_ms integer,
  device_info            text,
  created_at             timestamp NOT NULL DEFAULT now(),
  updated_at             timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS smart_locks_villa_unique ON smart_locks(villa_id);
CREATE INDEX        IF NOT EXISTS smart_locks_status_idx   ON smart_locks(status);
CREATE INDEX        IF NOT EXISTS smart_locks_protocol_idx ON smart_locks(protocol);
