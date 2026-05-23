-- 0015_add_vehicle_archived_at.sql
--
-- Phase 1 (dry-run): additive nullable `archived_at` column on `vehicles`.
--
-- This column is the soft-archive marker for temporary reservation vehicles
-- whose access window (check_out + 1h grace) has passed. In Phase 1 NOTHING
-- writes to this column — the dry-run sweep only logs candidates. The column
-- exists now so Phase 2 (real archive) is a pure code change with no further
-- migration.
--
-- Reversible: dropping the column is safe at any time (no data loss, no
-- referential integrity impact). The runtime ANPR / PIN / validator paths
-- do NOT read this column.
--
-- Idempotent: safe to re-run on prod where column may already exist.

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS vehicles_archived_at_idx ON vehicles (archived_at);
