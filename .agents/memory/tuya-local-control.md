---
name: Tuya local control feasibility
description: Why local LAN control of Tuya locks is hard; scan + local-key bootstrap constraints
---

Rule: Local-only control of Tuya **locks** (no cloud) is usually NOT viable for guest-PIN provisioning.

- tinytuya `scan` uses UDP broadcast (6666/6667/7000) which does NOT cross subnets/routers — devices on a different subnet show "Found 0 devices" even when unicast routing works.
- `scan -force <cidr>` (unicast probe of each IP on TCP 6668, can cross routers) REQUIRES local keys in `devices.json`; with no keys it prints `Force-scan requires keys in devices.json … Disabling force-scan` and silently falls back to broadcast.
- Local keys can only be bootstrapped from the Tuya **cloud** once via `tinytuya wizard` (needs Access ID/Secret from iot.tuya.com IoT Core, free tier). You cannot fully avoid touching the cloud at least once.
- Even with keys + IP reachable on 6668, lock **temporary-password (guest PIN)** management is generally a cloud-only API; local DPs rarely expose it. Battery/Zigbee locks behind a gateway are not directly on the LAN at all.

**Why:** VillaAccess pushes per-reservation guest PINs to locks; cloud-cost frustration drove a local attempt, but the server (6.5.4.x) and locks (172.16.20.x) are on separate subnets, so broadcast scan found nothing and force-scan was disabled for lack of keys.

**How to apply:** Tuya cloud project + IoT Core is free; the paywall is usually an expired *service trial* — use "Extend Trial Period" (monthly, free). The repo's Tuya integration (client/adapter/lock-sync/routes/dashboard LockDialog) is already complete and wired; only `TUYA_ACCESS_ID`/`TUYA_ACCESS_SECRET`/`TUYA_REGION` in `.env.docker` + registered lock rows are missing. Production compose loads `--env-file .env.docker` (NOT `.env`).
