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

**ROOT CAUSE (the real one): ticket_key was decrypted with the WRONG AES key.**
After ASCII name + IANA tz were fixed, the lock STILL returned 1109 with BOTH
epoch seconds AND milliseconds — proving the time unit was never the issue. The
actual bug was in `decryptTicketKey`: Tuya encrypts `ticket_key` with the **FULL
32-byte Access Secret as an AES-256-ECB key**, but the code used only the first
16 bytes as an AES-128 key. That yields a wrong 16-byte session key → the PIN is
encrypted with the wrong key → Tuya can't decrypt it → 1109 "param is illegal".
The 1109 here is a DECRYPTION failure surfaced as a generic param error, which is
why every other param looked perfect yet it still failed.
**Correct, forum-confirmed flow** (tuyaos.com t=2516, accepted answer p=15574):
1. decrypt `ticket_key` (hex) with **aes-256-ecb**, key = full Access Secret as
   UTF-8 (32 bytes); take the first 16 bytes of the result = session key.
2. encrypt the PIN with **aes-128-ecb** + PKCS7 using that 16-byte key.
3. send the ciphertext as **UPPERCASE hex** in `password`; `effective_time`/
   `invalid_time` in **epoch SECONDS** (10-digit); `password_type:"ticket"`.
**Why it was missed:** the code "looked" right (produced 32 hex = one block) and
nobody could test locally — Tuya creds live ONLY on the user's server, not in the
repl/code-exec sandbox, so every hypothesis cost a full server rebuild. Lesson:
for opaque crypto-handshake 1109s, verify the exact algorithm against Tuya's
forum/SDK FIRST rather than guessing param-by-param.

**Timestamp unit (earlier red herring) — model-dependent.** After fixing
the ASCII name + IANA timezone, the villa locks (products `bf2a…`, `bf56a0fe…`)
STILL returned 1109 with the body otherwise valid (`name:"popo"`,
`time_zone:"Europe/Sofia"`, future effective, 24h+ duration, 32-hex ticket
password). The remaining variable is the epoch unit of
`effective_time`/`invalid_time`: Tuya's documented default is **SECONDS** (10
digits) but some models were coded for **MILLISECONDS** (13 digits). A wrong unit
→ the timestamp is read as a far-future/illegal time → 1109. There is no single
correct answer across models, so `createTempPassword` now **tries seconds first
and on 1109 retries with milliseconds** (each attempt fetches a FRESH one-shot
ticket — a ticket cannot be reused). The `[tuya.createTempPassword] unit=… body=…`
log shows which unit was attempted; check it to learn the model's true unit.
(Old helper `toEpochSeconds` is dead code now — math is done in ms then divided.)

**Why it passes in dev but fails in prod:** dev test used a Latin name and a
host with a real IANA tz; the real reservation used a Cyrillic guest name in a
UTC Docker container. Same code, different inputs.

**Diagnosis:** the adapter logs the exact body at
`[tuya.createTempPassword] device=… body=…` (password redacted). grep that line
in `backend` logs right after a failed reservation; if it scrolled off, redo the
reservation with `docker compose logs -f backend | grep -E "tuya.createTempPassword|lock-sync"`.

## After 1109 is fixed: code 2314 "password length incorrect" → PIN must be 7 digits
Once the AES-256 ticket-key crypto was correct, the SAME 4-digit reservation PIN
flipped the error from 1109 → **2314 "password length incorrect"**. Tuya Wi-Fi
door locks via the ticket-based temp-password API require the PIN to be **EXACTLY
7 digits** (confirmed via 2 web searches; every official example is 7 digits,
e.g. "1234567"; 4 and 8 both fail). The system generates 4-digit PINs everywhere
(intercoms need 4).
**Resolution (user-approved):** intercom keeps its 4-digit PIN; the Tuya lock
gets a SEPARATE derived 7-digit code. `deriveLockPin(pin4) = pin4.repeat(2).slice(0,7)`
("1212"→"1212121") — deterministic, injective over 4-digit inputs (output prefix =
original 4 digits, so no collisions), preserves leading zeros. Only the value
PUSHED to Tuya changes; revoke/cross-ref stay keyed by `provider_password_id`,
not the PIN. The derived code is surfaced to operators on the reservation DETAIL
view only (`lock_pin_code`, gated on villa having a smart lock). User said "8
digits" but that's wrong for Tuya — it's 7.
