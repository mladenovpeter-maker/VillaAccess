-- ANPR / OCR V1 — additive column-only migration on the `cameras` table.
-- Safe to run on production: no data is touched, all new columns have defaults.
-- Apply on the self-hosted box:
--   docker compose exec db psql -U <user> -d <db> -f 0011_add_anpr_fields_to_cameras.sql

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS ocr_enabled            boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS polling_interval_ms    integer   NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS ocr_min_confidence     integer   NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS anpr_cooldown_seconds  integer   NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_anpr_plate        text,
  ADD COLUMN IF NOT EXISTS last_anpr_at           timestamp;
