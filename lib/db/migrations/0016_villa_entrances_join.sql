-- 0016_villa_entrances_join.sql
--
-- Phase A.0 (shadow): additive M:N join table linking villas to entrances.
--
-- Today `entrances.villa_id` is a single FK — an entrance belongs to at
-- most one villa. The real-world business case is the opposite: 2-3
-- physical gates that serve many villas, plus future cases where a
-- specific villa may have a private/restricted entrance.
--
-- This migration introduces the join table so the M:N relationship can
-- be expressed. It does NOT touch `entrances.villa_id` — that column
-- remains for backward-compat reads and is retired in a later phase.
--
-- Backfill policy (per agreed plan):
--   * Entrances with villa_id IS NOT NULL  -> insert 1 row (preserve
--     current behaviour exactly).
--   * Entrances with villa_id IS NULL      -> NO rows inserted. These
--     entrances did nothing before (ANPR skipped them with
--     "skipped_no_villa") and will continue to do nothing until an
--     operator links villas to them via the UI. Zero behaviour change.
--
-- Reversible: the table can be dropped at any time. No data loss in the
-- existing `entrances` rows.
--
-- Idempotent: safe to re-run on prod where the table / rows may already
-- exist (IF NOT EXISTS + ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS villa_entrances (
  villa_id    text NOT NULL REFERENCES villas(id)    ON DELETE CASCADE,
  entrance_id text NOT NULL REFERENCES entrances(id) ON DELETE CASCADE,
  created_at  timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY (villa_id, entrance_id)
);

CREATE INDEX IF NOT EXISTS villa_entrances_villa_idx    ON villa_entrances(villa_id);
CREATE INDEX IF NOT EXISTS villa_entrances_entrance_idx ON villa_entrances(entrance_id);

INSERT INTO villa_entrances (villa_id, entrance_id)
SELECT villa_id, id
FROM entrances
WHERE villa_id IS NOT NULL
ON CONFLICT DO NOTHING;
