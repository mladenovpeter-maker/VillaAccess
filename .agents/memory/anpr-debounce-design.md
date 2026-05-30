---
name: ANPR debounce design (denied dedup + gate-relay debounce)
description: Why/how distinct-but-similar OCR plate variants are collapsed on both the denied and allowed (relay) paths in anpr.ts.
---

# ANPR debounce — collapsing OCR variants of one lingering vehicle

A heavily occluded/dirty plate makes OCR emit many slightly-different reads for
the SAME car within seconds (e.g. CB2020XP / CB2020X / 7B2020X / 2B2020X /
B2020Y / B2020XE). Each distinct string clears the atomic exact-plate cooldown
claim (`last_anpr_plate IS DISTINCT FROM plate`), so without extra guards each
variant logs its own event AND (on the allowed path) re-fires the relay — the
dashboard floods and the barrier flaps open/close many times per visit.

Two additive, in-memory, per-camera guards in `anpr.ts` (no DB, no relay-driver
change). Both key on `similarityPct` (shift-tolerant) AND `sharedDigitCount`
(left-aligned positional digit match) within `camera.anpr_cooldown_seconds`.

- **Denied dedup** (`isDuplicateDenied`): suppresses the denied event INSERT +
  live publish only. AI fallback `recordFailure` ALWAYS still fires (never
  starved). Defaults: similarity ≥70, shared digits ≥3.
- **Gate-relay debounce** (`isRecentGateOpen`): on the allowed path, skips the
  relay pulse + duplicate allowed-event log when the read is a near-dup of the
  plate that GRANTED access.

**Why gate path requires 4 shared digits (not 3):** the variants of one car
preserve its full numeric core (e.g. "2020" → 4 left-aligned digits), but a
genuinely different car whose number differs by one digit (CB2021XP) shares only
3. Requiring 4 means a one-digit-different car is NOT suppressed and opens
normally. Erring high favours OPENING (safe) — worst case one extra relay pulse,
never a blocked car.

**Anchor rules (gate path):** recorded ONLY after a successful `gate.open`
(failed relay must not block retry); on a suppressed read only the timestamp is
extended while the anchor plate stays pinned to the GRANTING plate (no drift
toward suppressed variants).

**Residual, accepted limitation:** two different cars sharing the SAME number but
differing only in letters (CB2020XP vs CB2020XA) within the window are
indistinguishable from OCR letter-drift and could be collapsed. Negligible at a
low-traffic villa gate.

**Kill switches / tuning (env):** `ANPR_DENIED_DEDUP_SIMILARITY` /
`ANPR_DENIED_DEDUP_MIN_DIGITS`; `ANPR_GATE_DEDUP_SIMILARITY` (set 0 to fully
disable the gate debounce) / `ANPR_GATE_DEDUP_MIN_DIGITS`. Allowed path otherwise
unchanged.
