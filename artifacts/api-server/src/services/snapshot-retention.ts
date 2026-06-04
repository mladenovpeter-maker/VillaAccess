/**
 * Snapshot retention sweep — automatically purge old camera snapshots.
 *
 * Background: snapshot image files accumulate forever under
 *   uploads/snapshots/YYYY/MM/DD/
 * from three independent producers, all sharing the same date-folder layout:
 *   - POST /snapshots/upload        → "<uuid>.jpg"        (DB row in vehicle_snapshots)
 *   - camera polling (base.ts)      → "cam-<id8>-<uuid>"  (NO DB row)
 *   - ai-fallback (ai-fallback.ts)  → "ai_<uuid>"         (NO DB row)
 * The bulk of disk growth (cam-*, ai_*) is therefore NOT tracked in the
 * database, so a DB-only purge would never reclaim the space. This sweep deletes
 * by the on-disk date folder instead, which catches every producer.
 *
 * The retention window is read from system_settings → `snapshot_retention_days`
 * (default 90). A value <= 0 disables the sweep entirely (keep everything).
 *
 * Safety:
 *   - Each vehicle's CURRENT primary reference photo (vehicles.snapshot_url) is
 *     protected and never deleted, even if older than the window — so the
 *     registry thumbnails never break.
 *   - Only operates inside uploads/snapshots; never escapes that tree.
 *   - DB rows for purged (non-primary) snapshots are removed in lockstep so the
 *     gallery never shows broken images. Primary rows are kept.
 *   - Read-then-delete failures are swallowed per-file; one bad file never
 *     aborts the whole sweep.
 *
 * This is housekeeping only — it does NOT touch OCR/analysis, camera polling,
 * or the AI fallback pipeline.
 */
import path from "path";
import { promises as fs } from "fs";
import { db } from "@workspace/db";
import {
  systemSettingsTable,
  vehicleSnapshotsTable,
  vehiclesTable,
} from "@workspace/db";
import { and, eq, lt, isNotNull } from "drizzle-orm";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const SNAPSHOTS_ROOT = path.resolve(UPLOADS_ROOT, "snapshots");

const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Read snapshot_retention_days from settings; default 90, <=0 means disabled. */
async function getRetentionDays(): Promise<number> {
  try {
    const rows = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "snapshot_retention_days"))
      .limit(1);
    const raw = rows[0]?.value;
    if (raw == null) return DEFAULT_RETENTION_DAYS;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
    return n; // n <= 0 → caller treats as "disabled"
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

/** Convert a stored snapshot_url to an absolute on-disk path (or null). */
function urlToAbsPath(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/api\/uploads\/(.+)$/);
  const rel = m ? m[1] : url.replace(/^\/+/, "");
  if (!rel) return null;
  return path.resolve(UPLOADS_ROOT, rel);
}

async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** True for an integer-looking directory segment (year/month/day). */
function isNumericSeg(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Purge snapshots older than the retention window. Idempotent and safe to run
 * repeatedly. Returns counts for logging/observability.
 */
export async function purgeOldSnapshots(): Promise<{
  retentionDays: number;
  filesDeleted: number;
  bytesFreed: number;
  rowsDeleted: number;
  skippedProtected: number;
}> {
  const retentionDays = await getRetentionDays();

  if (retentionDays <= 0) {
    console.log("[snapshot-retention] disabled (retention_days <= 0) — skipping");
    return { retentionDays, filesDeleted: 0, bytesFreed: 0, rowsDeleted: 0, skippedProtected: 0 };
  }

  // Cutoff at local midnight, retentionDays ago. Folders strictly older than
  // this are eligible. Comparing at day granularity (conservative — may keep
  // one extra partial day) avoids deleting files from the trailing window.
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const cutoffMs = startOfToday - retentionDays * DAY_MS;
  const cutoffDate = new Date(cutoffMs);

  // Build the protected set: every vehicle's current primary reference photo.
  const protectedRows = await db
    .select({ url: vehiclesTable.snapshot_url })
    .from(vehiclesTable)
    .where(isNotNull(vehiclesTable.snapshot_url));
  const protectedPaths = new Set<string>();
  for (const r of protectedRows) {
    const abs = urlToAbsPath(r.url);
    if (abs) protectedPaths.add(abs);
  }

  let filesDeleted = 0;
  let bytesFreed = 0;
  let skippedProtected = 0;

  // Walk the known YYYY/MM/DD structure only (never recurse blindly).
  const years = await listDirSafe(SNAPSHOTS_ROOT);
  for (const yyyy of years) {
    if (!isNumericSeg(yyyy)) continue;
    const yearDir = path.join(SNAPSHOTS_ROOT, yyyy);
    const months = await listDirSafe(yearDir);
    for (const mm of months) {
      if (!isNumericSeg(mm)) continue;
      const monthDir = path.join(yearDir, mm);
      const days = await listDirSafe(monthDir);
      for (const dd of days) {
        if (!isNumericSeg(dd)) continue;
        const dayDir = path.join(monthDir, dd);

        const folderMs = new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
        if (Number.isNaN(folderMs) || folderMs >= cutoffMs) continue; // within window — keep

        const files = await listDirSafe(dayDir);
        for (const f of files) {
          const abs = path.join(dayDir, f);
          if (protectedPaths.has(abs)) {
            skippedProtected++;
            continue;
          }
          try {
            const st = await fs.stat(abs);
            if (!st.isFile()) continue;
            await fs.unlink(abs);
            filesDeleted++;
            bytesFreed += st.size;
          } catch {
            // already gone / permission — ignore this file, keep sweeping
          }
        }

        // Remove the day folder if it ended up empty (protected files keep it).
        await fs.rmdir(dayDir).catch(() => {});
      }
      await fs.rmdir(monthDir).catch(() => {});
    }
    await fs.rmdir(yearDir).catch(() => {});
  }

  // Keep the DB consistent: drop non-primary snapshot rows whose files we just
  // purged. Primary rows are preserved (their files were protected).
  let rowsDeleted = 0;
  try {
    const deleted = await db
      .delete(vehicleSnapshotsTable)
      .where(
        and(
          lt(vehicleSnapshotsTable.captured_at, cutoffDate),
          eq(vehicleSnapshotsTable.is_primary, false),
        ),
      )
      .returning({ id: vehicleSnapshotsTable.id });
    rowsDeleted = deleted.length;
  } catch (err) {
    console.error("[snapshot-retention] DB row cleanup failed:", err);
  }

  console.log(
    `[snapshot-retention] done: retention=${retentionDays}d ` +
      `files=${filesDeleted} freed=${(bytesFreed / 1024 / 1024).toFixed(1)}MB ` +
      `rows=${rowsDeleted} protected=${skippedProtected}`,
  );

  return { retentionDays, filesDeleted, bytesFreed, rowsDeleted, skippedProtected };
}

// ─── Periodic sweep ─────────────────────────────────────────────────────────

let sweepInFlight = false;
async function runPurgeGuarded(label: string): Promise<void> {
  if (sweepInFlight) {
    console.log(`[snapshot-retention] ${label} skipped — previous run still in flight`);
    return;
  }
  sweepInFlight = true;
  try {
    await purgeOldSnapshots();
  } catch (err) {
    // Housekeeping failure MUST NOT affect anything else. Log; next tick retries.
    console.error(`[snapshot-retention] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

/**
 * Start the periodic retention sweep. Safe to call once at server boot.
 * Default cadence: daily. Initial run is staggered after boot so it doesn't
 * collide with the PIN/lock/archive sweeps' startup window.
 */
export function startSnapshotRetentionSweep(intervalMs = DAY_MS): NodeJS.Timeout {
  setTimeout(() => void runPurgeGuarded("initial run"), 90_000);
  return setInterval(() => void runPurgeGuarded("periodic run"), intervalMs);
}
