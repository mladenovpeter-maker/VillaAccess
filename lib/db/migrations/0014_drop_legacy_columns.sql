-- Migration 0014 — Drop legacy columns no longer present in the TS schema.
--
-- These columns were removed during the entrances/intercom refactor and the
-- ANPR cleanup. `drizzle-kit push` refused to apply the drops without
-- interactive confirmation (it can't distinguish rename-vs-drop on its own),
-- which broke non-TTY Docker startup. Codifying the drops explicitly here
-- means production migration is deterministic and prompt-free.
--
-- Columns being removed:
--   * intercoms.last_latency_ms  — diagnostic field, never read by code
--   * cameras.use_access_control — legacy ACS routing flag, obsolete
--   * cameras.door_no            — legacy ACS door selector, obsolete
--
-- Idempotent: each DROP uses IF EXISTS, so re-running is a no-op on a fresh
-- dev DB that never had the columns.

ALTER TABLE intercoms DROP COLUMN IF EXISTS last_latency_ms;
ALTER TABLE cameras   DROP COLUMN IF EXISTS use_access_control;
ALTER TABLE cameras   DROP COLUMN IF EXISTS door_no;
