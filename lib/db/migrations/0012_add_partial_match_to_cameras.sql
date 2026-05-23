-- ANPR / OCR — additive column-only migration on the `cameras` table for
-- fuzzy / partial plate matching.
--
-- Safe to run on production:
--   * No data is touched.
--   * All new columns have defaults; existing behaviour (exact-only matching)
--     is preserved because `allow_partial_match` defaults to false.
--
-- Apply on the self-hosted box:
--   docker compose exec db psql -U <user> -d <db> \
--     -f 0012_add_partial_match_to_cameras.sql

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS allow_partial_match     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_match_threshold integer NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS partial_min_confidence  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS min_matching_digits     integer NOT NULL DEFAULT 4;
