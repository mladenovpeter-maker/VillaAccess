---
name: Reservation delete vs. PIN-revoke failure
description: Why DELETE /reservations/:id only blocks on revoke failure for non-expired reservations
---

# DELETE /reservations/:id — revoke gating

`DELETE` first attempts to revoke the PIN from every Hikvision intercom. On
revoke failure it must decide whether to abort or proceed:

- **Active/upcoming reservation** (access window NOT elapsed) → abort with 502,
  do NOT delete. An orphaned PIN here would still grant entry.
- **Expired reservation** (`check_out + 1h grace < now`) → log a warning and
  delete anyway. The PIN is past its validity endTime, so it is inert; blocking
  the delete just traps the operator.

**Gate strictly on the elapsed time window, NOT on status.** A `completed` or
`cancelled` booking can still have a future endTime (early checkout, pre-stay
cancellation), so status alone does not prove the PIN is inert.

**Why this exists:** users reported "can't delete a past reservation — error".
Cause: for expired bookings the expiry sweep already removed the device user, and
`HikvisionIntercomService.revokePin` only treats HTTP 404 or a body containing
"no matched" as success — other firmware "user not found" shapes (HTTP 200 with
`statusCode != 1`) count as failure and used to 502 the whole delete.

**Grace constant** mirrors `CHECKOUT_GRACE_MS` (1h) in the reservation validator;
keep them equal.
