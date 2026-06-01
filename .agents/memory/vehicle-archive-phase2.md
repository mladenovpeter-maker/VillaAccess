---
name: Vehicle archive Phase 2 (soft-archive on reservation expiry)
description: How expired reservation vehicles disappear from the list, and the race rule for the archiving sweep
---

# Vehicle archive — Phase 2

Temporary reservation vehicles are **soft-archived** (column `archived_at`
timestamp), never deleted. Access control already denies them via the access
window; archiving only removes them from the operational list.

**Three coupled parts** (all must stay in sync):
1. Sweep (`services/vehicle-archive.ts`, 5-min interval) sets `archived_at=NOW()`
   on eligible rows. `DRY_RUN` flag toggles log-only vs live.
2. `GET /vehicles` hides `archived_at IS NOT NULL` by default; `?include_archived=true` shows them.
3. `resolveLicensePlates` (reservations) sets `archived_at=NULL` when a returning
   guest reuses an existing plate — repeat guests reappear instead of duplicating.

**Race rule (critical):** the archiving step must be ONE atomic SQL `UPDATE`
that re-evaluates the full eligibility predicate (access_type='reservation',
not blacklisted, has a reservation link, and NO reservation with
`check_out + 1h grace > NOW()`). Do NOT archive a pre-selected id list — between
the candidate SELECT and the UPDATE a vehicle can be re-linked to a new/future
reservation; only re-checking inside the UPDATE prevents archiving an
active/upcoming vehicle. Part 3 covers the residual commit-after-snapshot window.

**Why:** archiving an active vehicle would hide a current guest's car from the
operator even though access still works — confusing and looks like data loss.

**Grace:** `ARCHIVE_GRACE_MS` MUST equal `CHECKOUT_GRACE_MS` (1h) in the
validator (value is not exported there by design; mirrored here).

**Counts must match the list:** any aggregate that counts vehicles (e.g. the
dashboard `/stats` "total_vehicles" card) MUST apply `archived_at IS NULL`, same
as `GET /vehicles`. Otherwise the dashboard shows e.g. "1 vehicle" while the list
is empty. Keep every vehicle count and the list filter in lockstep.
