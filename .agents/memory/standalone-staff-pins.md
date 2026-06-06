---
name: Standalone staff PINs
description: Non-reservation PINs in Временен достъп reach Hikvision intercoms only; how they stay isolated from the reservation path.
---

Temp credentials support two modes: reservation-linked (legacy) and standalone staff PINs (owner_name, no reservation_id).

**Rule:** Standalone PINs sync to Hikvision intercoms ONLY (never Tuya), via a SEPARATE service from the reservation path. Do not route standalone PINs through the reservation pin-sync/lock-sync code, and do not push reservation-linked temp_credentials to hardware here (the reservation flow already does that — double-pushing would create duplicate device users).

**Why:** The reservation PIN sync path is protected/pristine; standalone staff PINs are an additive feature. The reservation employeeNo namespace and the standalone one (hash of `cred:<id>`) are deliberately disjoint so device users never collide.

**How to apply:**
- "permanent" access_type stores a far-future sentinel (2099-12-31) because Hikvision requires an end time; expiry logic must skip permanent rows so they never flip to expired.
- Reservation-linked credentials must be forced to access_type "temporary" — if a permanent value leaks onto the legacy path, those rows would never auto-expire.
- Standalone sync targets = intercoms filtered to pin_sync_enabled AND protocol=hikvision, so non-Hikvision devices don't pollute sync_status as "failed". With zero targets, sync_status = "not_applicable" (not failure).

**Hikvision Y2038 cap (permanent PINs):** the DB 2099 sentinel CANNOT be sent to the device — Hikvision DS-K terminals use 32-bit time_t and reject any endTime past ~2038, so a permanent PIN push fails (sync_status=failed, UI "Грешка при синхронизация"). The standalone sync caps the *device-side* validTo to a safe in-2037 value (2037-12-30T12:00:00Z, headroom for any server TZ vs formatHikDate's local-time formatting) while leaving the 2099 DB row untouched. **Why:** reservations never hit this (near-term dates), so it only surfaced on permanent staff PINs. **How to apply:** any far-future device validity must be clamped below 2038 before pushPin; don't change the shared formatHikDate or the reservation path. Existing failed permanent PINs self-heal on re-sync (edit) or delete+recreate.
