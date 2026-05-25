-- 0019_smart_lock_passwords_unique_active.sql
--
-- Phase 2 hardening: prevent duplicate ACTIVE temp-passwords for the
-- same (reservation, smart_lock) pair.
--
-- Race scenario this guards against:
--   Two concurrent POST /reservations/:id/regenerate-pin calls (or two
--   simultaneous date-change PUTs) on the same reservation both observe
--   zero active rows in the defensive pre-revoke step, both call the
--   Tuya API to create a temp password, and both insert a row with
--   status='active'. The lock then carries two valid PINs and the
--   ledger no longer points at "the" current password to revoke.
--
-- A partial UNIQUE INDEX on the (reservation_id, smart_lock_id) tuple
-- restricted to status='active' is the cheapest fix:
--   - the second INSERT fails with 23505, the orchestrator catches it
--     and re-issues a delete of the orphaned Tuya password (since
--     createTempPassword already succeeded for the loser);
--   - revoked rows remain unconstrained so audit history is preserved;
--   - failed rows also remain unconstrained so the sweep can retry
--     them without colliding with a fresh active row.
--
-- Reversible via DROP INDEX. Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS slp_one_active_per_lock_idx
  ON smart_lock_passwords (reservation_id, smart_lock_id)
  WHERE status = 'active';
