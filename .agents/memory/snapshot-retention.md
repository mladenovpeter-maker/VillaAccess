---
name: Snapshot retention / purge
description: How snapshot files are produced and why retention purges by filesystem date-folder
---

# Snapshot retention purge

Snapshot image files live under `uploads/snapshots/YYYY/MM/DD/` and are written
by **three independent producers**, all sharing that date-folder layout:

- `POST /snapshots/upload` (multer) → `<uuid>.jpg` — **has** a `vehicle_snapshots` DB row.
- camera polling (`lib/cameras/base.ts` `saveImageBuffer`) → `cam-<id8>-<uuid>` — **no** DB row.
- AI fallback (`services/ai-fallback.ts` `persistSnapshot`) → `ai_<uuid>` — **no** DB row.

**Key consequence:** the bulk of disk growth is NOT tracked in the database, so a
DB-only purge cannot reclaim it. Retention therefore purges by the **on-disk
date folder** (delete whole `YYYY/MM/DD` folders older than the window), which
catches every producer, and only afterwards drops matching non-primary DB rows
to keep the gallery consistent.

**Why protect primaries:** `vehicles.snapshot_url` points at a vehicle's current
reference photo shown in the registry; that exact file path is excluded from
deletion so thumbnails never break, and its DB row (is_primary) is kept.

**Control:** window comes from `system_settings.snapshot_retention_days`
(default 90). `<= 0` disables the sweep entirely. The same setting key was a
dead UI label before — it had no executor until this sweep.

**Note:** the dashboard does NOT display snapshots inline; they are only raw
material for OCR/manual inspection (per the owner). So aggressive retention is
acceptable.
