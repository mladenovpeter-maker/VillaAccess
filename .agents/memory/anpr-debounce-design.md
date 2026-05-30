---
name: ANPR debounce design (denied dedup + gate-relay debounce)
description: Why/how distinct-but-similar OCR plate variants are collapsed on both the denied and allowed (relay) paths in anpr.ts, and why matching is shift-invariant.
---

# ANPR debounce — collapsing OCR variants of one lingering vehicle

A heavily occluded/dirty plate makes OCR emit many slightly-different reads for
the SAME car within seconds. Each distinct string clears the atomic exact-plate
cooldown claim (`last_anpr_plate IS DISTINCT FROM plate`), so without extra
guards each variant logs its own event AND (on the allowed path) re-fires the
relay — the dashboard floods and the barrier flaps open many times per visit.
Observed worst case: one parked, unmoved authorized car opened the gate 52×/90min.

Two additive, in-memory, per-camera guards in `anpr.ts` (no DB, no relay-driver
change), keyed within `camera.anpr_cooldown_seconds`.

## The shift-invariance lesson (the core bug)

OCR does not just substitute chars — it ADDS or DROPS a leading char, so the
stable numeric core drifts in POSITION across reads of one car: `B2020Y` (core
at offset 1) vs `EB2020X` / `CB2020X` / `3B2020YE` (core at offset 2). Any
LEFT-ALIGNED comparison silently breaks under this drift.

**Why:** the old gate/denied test combined `similarityPct` with
`sharedDigitCount`, which only counts digits matching at the SAME index. Under a
one-char prefix shift it returns 0 even though both reads obviously contain
"2020" → the debounce never collapsed → the relay re-fired per variant.

**How to apply:** for dedup/debounce matching, use `longestCommonRun(a,b)` — the
longest run of CONSECUTIVE chars common to both strings regardless of offset
(shift-invariant LCSubstring, DP). Never reach for positional/left-aligned digit
overlap on the dedup path again.

## Current thresholds & rationale

- **Gate-relay debounce** (`isRecentGateOpen`, allowed path): suppress relay
  pulse + duplicate allowed-log when `longestCommonRun(plate, grantingPlate) >=
  GATE_DEDUP_MIN_RUN` (default **5**). 5 = the 4-digit core PLUS one adjacent
  letter. A 5-char run in an EU plate necessarily spans the digit block (letter
  runs alone never reach 5), so this both fixes the shift-miss AND keeps two
  genuinely different cars sharing only the same 4 digits (run = 4 < 5) distinct.
- **Denied dedup** (`isDuplicateDenied`): suppress denied INSERT + live publish
  only when `longestCommonRun >= DENIED_DEDUP_MIN_RUN` (default **4**). Pure UI
  log hygiene — no access/relay impact — so over-collapsing only costs a log row.
  AI fallback `recordFailure` ALWAYS still fires (never starved).

## Anchor rules (gate path)

Anchor recorded ONLY after a successful `gate.open` (a failed relay must not
block retry). On a suppressed read only the timestamp is extended (window keeps
the lingering car collapsed → ~1 open for a long park) while the anchor plate
stays pinned to the GRANTING plate (no drift toward suppressed variants).

## Residual, accepted limitation (do NOT "fix" with similarity)

Two DIFFERENT authorized cars that share a 5+ run (same region letter + same 4
digits, e.g. CB2020XE vs CB2020MK) arriving within the window are collapsed, and
because the window extends on each suppressed read the second car can be starved
until a quiet gap. This risk already existed in the prior design and is accepted
as negligible at a low-traffic private villa.

**Why not add a similarity AND-guard:** heavy OCR garbling drops overall
similarity (own variant 82020XP vs CB2020XE ≈50%) BELOW that of a genuinely
different car (CB2020MK vs CB2020XE ≈75%). So similarity ranks the wrong car as
"closer" and would re-break the shift fix while not separating the two cases.
The string-only signal cannot distinguish them; this is inherent.

## Kill switches / tuning (env)

- `ANPR_GATE_DEDUP_SIMILARITY` — kept ONLY as the gate on/off switch (set 0 to
  fully disable gate debounce and restore "open on every distinct allowed read").
- `ANPR_GATE_DEDUP_MIN_RUN` (default 5), `ANPR_DENIED_DEDUP_MIN_RUN` (default 4),
  `ANPR_DENIED_DEDUP_SIMILARITY` (denied on/off, >0 = on).

`similarityPct()` and `sharedDigitCount()` are UNCHANGED and still used by the
fuzzy access-decision matcher — that path (and OCR/relay-driver) is untouched.
