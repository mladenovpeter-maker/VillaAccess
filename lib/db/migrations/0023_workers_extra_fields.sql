-- Phase 2 fixes:
--   workers: add badge_no (unique card/badge number) and photo_url
--   access_rules: add active flag for non-destructive disable semantics

ALTER TABLE workers ADD COLUMN IF NOT EXISTS badge_no   TEXT UNIQUE;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS photo_url  TEXT;

ALTER TABLE access_rules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS access_rules_active_idx ON access_rules(active);
