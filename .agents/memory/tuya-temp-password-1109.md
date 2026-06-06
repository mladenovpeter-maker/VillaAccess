---
name: Tuya temp-password 1109 "param is illegal" causes
description: What makes /door-lock/temp-password reject with code 1109, and which params are safe to harden.
---

# Tuya door-lock temp-password — code 1109 "param is illegal"

1109 is GENERIC ("some param rejected") on
`POST /v1.0/devices/{id}/door-lock/temp-password`. It does NOT say which field.
Known triggers, in rough order of how often they bite here:

- **Non-ASCII `name`.** Tuya's temp-password `name` accepts only ASCII
  letters/digits/spaces. A Cyrillic guest name (e.g. "попо") → 1109. Fix:
  transliterate Cyrillic→Latin + strip remaining non-`[A-Za-z0-9 ]`, fallback
  "Guest". (This was the real cause for the villa deployment.)
- **`time_zone` = "UTC"/"Etc/UTC".** Tuya wants a real IANA region name.
  `Intl…resolvedOptions().timeZone` returns "UTC" inside a Docker/UTC container,
  which some lock models reject → 1109. Fall back to "Europe/Sofia" when it
  resolves to UTC/empty. (Offset format like "+02:00" is ALSO rejected.)
- **effective_time not strictly in the future** (now+0 → 1109). Bump by ~60s.
- **(invalid_time - effective_time) < ~24h.** Tuya enforces a 24h minimum
  duration for type=0 temp passwords; <24h → 1109. Bump invalid_time up.

**Timestamp unit:** these locks now want epoch **MILLISECONDS** (helper
`toEpochSeconds` is misnamed, returns `d.getTime()`). Don't "fix" it to seconds.

**Why it passes in dev but fails in prod:** dev test used a Latin name and a
host with a real IANA tz; the real reservation used a Cyrillic guest name in a
UTC Docker container. Same code, different inputs.

**Diagnosis:** the adapter logs the exact body at
`[tuya.createTempPassword] device=… body=…` (password redacted). grep that line
in `backend` logs right after a failed reservation; if it scrolled off, redo the
reservation with `docker compose logs -f backend | grep -E "tuya.createTempPassword|lock-sync"`.
