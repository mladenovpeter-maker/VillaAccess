---
name: Tuya door-lock opening journal & battery sourcing
description: Which Tuya cloud endpoints actually yield unlock history and battery for these locks, and why the obvious ones return empty/null.
---

# Tuya door-lock: opening journal + battery

**Opening history comes from device-logs, NOT door-lock/open-records.**
`/v1.0/devices/{id}/door-lock/open-records` returns empty for many lock models
(incl. the units in this deployment). The reliable source is the generic device
log stream `/v1.0/devices/{id}/logs` with `type=7` (data-point report): each
opening surfaces as a DP report where `code` ∈ `unlock_fingerprint|unlock_password|
unlock_card|unlock_face|unlock_key|unlock_app|unlock_temporary|...` and `value` =
the credential slot/index used. Over-fetch (`size`≈50-100) over a time window and
filter to unlock_* codes — the same log stream carries online/battery/other DP
reports as noise.
**Why:** open-records is a higher-level convenience not populated by these locks;
the DP-report log is the ground truth.

**Battery (`residual_electricity`) needs a separate status fetch.**
`/v1.0/iot-03/devices/{id}` (device detail) does NOT reliably include the live DP
`status` array, so battery extraction returns null from it alone. Fetch
`/v1.0/devices/{id}/status` (returns `[{code,value}]`) to get `residual_electricity`.

**Device-logs paging is cursor-based (row-key/next_row_key), not page numbers.**
Don't fake page-number paging; serve the recent window and report no further pages
for page>1, or thread the cursor explicitly.

**No user names / no PIN digits.** DP-report logs give only the credential index,
never the enrolled person's name or the actual PIN — Tuya never returns PIN digits.
