---
name: Reservation datetime timezone handling
description: How check-in/check-out date+time must cross the wire to avoid offset drift
---

# Reservation date/time timezone contract

The reservation form (dashboard) and backend exchange check_in/check_out as
absolute instants. The browser is the source of truth for the operator's local
wall-clock time (Europe/Sofia).

**Rule:** the frontend MUST send a fully-qualified UTC instant
(`new Date("<local>").toISOString()`), and MUST display using browser-local
components. Never send a naive `YYYY-MM-DDTHH:mm:ss` string.

**Why:** a naive string has no timezone designator, so the server's
`new Date(...)` parses it in the *server's* TZ (the Docker container is UTC).
The dashboard then renders in browser-local, so each save shifted the time by
the UTC offset (+2/+3h). Symptom: operator sets 06:00, reload shows 09:00 —
looks like "the edit didn't save". Both date and time helpers must agree on the
SAME timezone (local), or near-midnight values split across days.

**How to apply:** keep `handleSubmit` wrapping in `.toISOString()`; keep
`toInputDate`/`toInputTime` on local getters (getFullYear/getMonth/getDate,
getHours/getMinutes). Rows created before this fix keep their old shifted
instant until manually re-saved once; they no longer drift further.

**Same trap elsewhere:** any `<input type="datetime-local">` helper in the
dashboard must format from local components, never `toISOString().slice(0,16)`
(UTC). The temp-credentials page (`toInputDateTime`) had this bug — editing
label/notes silently shifted the validity window on save because the form
re-initialized from a UTC wall-clock string. Fixed to local components; the
edit submit only sends valid_from/valid_until when the instant actually
changed, so unrelated edits don't rewrite the window or re-sync the device.
