-- 0020_standalone_temp_credentials.sql
--
-- Allow "Временен достъп" PINs to exist WITHOUT a reservation, mirroring the
-- standalone Vehicles model. Used for staff PINs (cleaner/gardener — temporary;
-- manager/owner — permanent). These standalone PINs are pushed to Hikvision
-- intercoms only (never Tuya locks).
--
-- Additive & idempotent:
--   * reservation_id becomes nullable (standalone rows store NULL). The FK and
--     ON DELETE CASCADE remain; NULL is simply ignored by the FK.
--   * owner_name   — display name for standalone PIN holders.
--   * access_type  — "temporary" (window-bound, default) | "permanent" (no end).
--   * sync_status  — last intercom push result for standalone PINs.
--
-- Reversible: drop the added columns and re-add NOT NULL on reservation_id.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'temp_credential_access_type') THEN
    CREATE TYPE temp_credential_access_type AS ENUM ('temporary', 'permanent');
  END IF;
END$$;

ALTER TABLE temp_credentials ALTER COLUMN reservation_id DROP NOT NULL;

ALTER TABLE temp_credentials
  ADD COLUMN IF NOT EXISTS owner_name  text,
  ADD COLUMN IF NOT EXISTS access_type temp_credential_access_type NOT NULL DEFAULT 'temporary',
  ADD COLUMN IF NOT EXISTS sync_status text;
