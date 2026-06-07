-- Phase 1 Cleanup: Remove Tuya smart locks, reservations, villas, temp_credentials
-- Apply with: psql $DATABASE_URL -f 0021_phase1_cleanup.sql
-- Safe to run multiple times (IF EXISTS guards).

-- 1. Drop leaf tables first (no other tables depend on them)
DROP TABLE IF EXISTS smart_lock_passwords;

-- 2. reservation_vehicles references reservations
DROP TABLE IF EXISTS reservation_vehicles;

-- 3. villa_entrances references villas + entrances
DROP TABLE IF EXISTS villa_entrances;

-- 4. smart_locks references villas
DROP TABLE IF EXISTS smart_locks;

-- 5. temp_credentials references reservations (via FK)
DROP TABLE IF EXISTS temp_credentials;

-- 6. reservations references villas
DROP TABLE IF EXISTS reservations;

-- 6b. Drop the entrances.villa_id FK column BEFORE dropping villas
--     (entrances has a FK constraint to villas that must go first)
ALTER TABLE IF EXISTS entrances DROP COLUMN IF EXISTS villa_id;

-- 7. villas — nothing left references it
DROP TABLE IF EXISTS villas;

-- 8. Drop enums that were used exclusively by the removed tables
DROP TYPE IF EXISTS villa_status;
DROP TYPE IF EXISTS smart_lock_status;
DROP TYPE IF EXISTS smart_lock_protocol;
DROP TYPE IF EXISTS reservation_status;
DROP TYPE IF EXISTS pin_sync_status;
DROP TYPE IF EXISTS temp_credential_status;
DROP TYPE IF EXISTS temp_credential_sync_status;
DROP TYPE IF EXISTS temp_credential_access_type;

-- 9. Alter entrances: drop legacy villa_id FK column, add access_level
ALTER TABLE entrances DROP COLUMN IF EXISTS villa_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'entrance_access_level'
  ) THEN
    CREATE TYPE entrance_access_level AS ENUM ('public', 'restricted', 'admin_only');
  END IF;
END $$;

ALTER TABLE entrances
  ADD COLUMN IF NOT EXISTS access_level entrance_access_level NOT NULL DEFAULT 'public';

-- 10. Seed 3 default entrances (idempotent — skips if name already exists)
INSERT INTO entrances (id, name, description, access_level, active, created_at, updated_at)
SELECT gen_random_uuid(), 'Турникет', 'Основен вход за целия обект', 'public', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM entrances WHERE name = 'Турникет');

INSERT INTO entrances (id, name, description, access_level, active, created_at, updated_at)
SELECT gen_random_uuid(), 'Сграда Администрация', 'Ограничен достъп — само оторизиран персонал', 'restricted', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM entrances WHERE name = 'Сграда Администрация');

INSERT INTO entrances (id, name, description, access_level, active, created_at, updated_at)
SELECT gen_random_uuid(), 'Врата Управител', 'Само управленски достъп', 'admin_only', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM entrances WHERE name = 'Врата Управител');
