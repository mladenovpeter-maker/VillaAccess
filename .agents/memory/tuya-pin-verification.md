---
name: Tuya PIN verification on device
description: How to verify a guest PIN is really loaded on a Tuya lock (device vs ledger reconciliation)
---

To prove a guest PIN is actually on a Tuya lock, reconcile two sources:
- **Live device truth**: `adapter.listTempPasswords()` (Tuya `door-lock/temp-passwords`) — the temp-passwords physically on the device now.
- **System ledger**: `smart_lock_passwords` rows (status `active`), joined to `reservations` for guest/window.

Join key is `provider_password_id` ↔ device `password_id`.

**Key signal:** a ledger row that is `active` but whose `provider_password_id` is NOT in the live device list = the PIN is missing on the lock → that guest is locked out. Remediation: regenerate the reservation PIN to re-push.

**Why:** "the system says the PIN synced" and "the PIN is on the door" are different claims; only the device list confirms the latter. Tuya temp-password `status` strings: `normal` (active), `to_be_activated` (pending), `expired`.

**How to apply:** this drives `GET /api/locks/:id/passwords` and the "Lock PINs" dialog. Keep it read-only — do NOT route this through lock-sync push/revoke logic.
