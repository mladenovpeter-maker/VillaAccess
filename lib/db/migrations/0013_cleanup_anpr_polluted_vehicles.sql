-- Migration 0013 — Clean up vehicle rows auto-created by the pre-fix ANPR
-- pipeline. From this version on, services/anpr.ts NO LONGER inserts into
-- the vehicles table; OCR detections live only in access_events /
-- domain_events.
--
-- Provenance signature of an OCR-auto-created row (the "smoking gun"):
--   * status = 'unknown'                       — old code's hard-coded default
--   * make / model / color all NULL            — old code never set these
--   * updated_at = created_at                  — never touched by an admin
--   * no reservation_vehicles link             — never assigned to a guest
--   * AND an access_events row exists for this vehicle_id whose created_at
--     is within 5 seconds of the vehicle's created_at — the auto-insert
--     and the denied/allowed event were written back-to-back in the same
--     request. A genuine admin-added vehicle (even one left blank with
--     defaults) will not have this co-temporal access_event, because the
--     event only exists if a camera detected the plate, in which case the
--     old code would have produced exactly this signature.
--
-- FK safety:
--   * access_events.vehicle_id — no FK constraint; rows keep their (now-
--     orphan) text pointer, which is harmless for historical reporting.
--   * domain_events.vehicle_id — FK with ON DELETE SET NULL.
--   * reservation_vehicles.vehicle_id — no FK; excluded defensively above.
--
-- Idempotent: safe to re-run.

DELETE FROM vehicles v
WHERE v.status = 'unknown'
  AND v.make IS NULL
  AND v.model IS NULL
  AND v.color IS NULL
  AND v.updated_at = v.created_at
  AND NOT EXISTS (
    SELECT 1 FROM reservation_vehicles rv WHERE rv.vehicle_id = v.id
  )
  AND EXISTS (
    SELECT 1 FROM access_events ae
    WHERE ae.vehicle_id = v.id
      AND ae.created_at BETWEEN v.created_at AND v.created_at + INTERVAL '5 seconds'
  );
