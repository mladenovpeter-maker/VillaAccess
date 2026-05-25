-- 0018_add_smart_lock_passwords.sql
--
-- Phase 2: per-reservation temp-password ledger for smart locks.
--
-- For each reservation that we push a PIN to a smart lock, the lock's
-- provider returns its own opaque password_id. We must remember that
-- id so we can revoke the password later (on cancel/checkout/expiry/
-- regenerate). Storing it in a dedicated table keeps the reservations
-- table protocol-agnostic and supports future locks that may have
-- multiple passwords per reservation.
--
-- Lifecycle:
--   * On create/regen sync → INSERT row with status='active'
--   * On revoke/cancel/checkout → UPDATE row SET status='revoked',
--     revoked_at=now() (the row is kept as audit history)
--   * On revoke failure → status='failed', sweep retries
--
-- Reversible via DROP TABLE. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smart_lock_password_status') THEN
    CREATE TYPE smart_lock_password_status AS ENUM ('active', 'revoked', 'failed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS smart_lock_passwords (
  id                   text PRIMARY KEY,
  reservation_id       text NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  smart_lock_id        text NOT NULL REFERENCES smart_locks(id)  ON DELETE CASCADE,
  provider_password_id text NOT NULL,
  status               smart_lock_password_status NOT NULL DEFAULT 'active',
  last_error           text,
  created_at           timestamp NOT NULL DEFAULT now(),
  revoked_at           timestamp
);

CREATE INDEX IF NOT EXISTS slp_reservation_idx ON smart_lock_passwords(reservation_id);
CREATE INDEX IF NOT EXISTS slp_lock_idx        ON smart_lock_passwords(smart_lock_id);
CREATE INDEX IF NOT EXISTS slp_status_idx      ON smart_lock_passwords(status);
