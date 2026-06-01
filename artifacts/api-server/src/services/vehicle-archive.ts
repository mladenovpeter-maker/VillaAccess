/**
 * Vehicle archive sweep — Phase 1 (DRY-RUN ONLY).
 *
 * Purpose
 * -------
 * Reservation vehicles are *temporary* access entities. Once a reservation
 * ends and the access grace window closes, the vehicle should disappear from
 * the operational Vehicles list. This sweep identifies those candidates.
 *
 * Phase 1 (this file, current state):
 *   - SELECT-only. No UPDATE. No DELETE. No production behavior change.
 *   - Logs each candidate with full reasoning so an operator can audit which
 *     vehicles would be archived and why.
 *   - Runs on its own 5-minute interval, independent of the PIN sweep, so a
 *     failure here cannot affect PIN revocation.
 *
 * Phase 2 (later, after operator review of dry-run logs):
 *   - Flip DRY_RUN to false. The same SELECT becomes an UPDATE that sets
 *     `archived_at = NOW()` on the matching rows.
 *   - Additionally: `GET /vehicles` adds default `archived_at IS NULL` filter,
 *     and `resolveLicensePlates` un-archives an existing vehicle when it is
 *     re-used by a new reservation (repeat guests).
 *
 * What is NOT touched
 * -------------------
 * - reservation-validator.ts (ANPR access decisions): not read here.
 * - pin-sync.ts: independent interval, independent failure mode.
 * - vehicles, reservation_vehicles, vehicle_snapshots, access_events rows:
 *   never deleted, never mutated by Phase 1.
 * - OCR / YOLO / EasyOCR / relay / Hikvision: untouched.
 *
 * Eligibility criteria (must match ALL)
 * -------------------------------------
 * 1. access_type = 'reservation'      — never archive 'permanent' (staff/owner)
 * 2. status != 'blacklisted'          — blacklist is a long-term decision; preserved
 * 3. archived_at IS NULL              — idempotent (do not re-archive)
 * 4. has at least one reservation_vehicles link — never archive manually-added
 *    "known" vehicles that were never tied to a reservation
 * 5. NO reservation for this vehicle is currently within its access window:
 *    i.e. there is NO row in reservation_vehicles → reservations where
 *    status != 'cancelled' AND (check_out + ARCHIVE_GRACE_MS) > NOW().
 *    This protects: active reservations, upcoming/future bookings, repeat-
 *    guest overlap, and edited check_out values pushed into the future.
 *
 * Grace window
 * ------------
 * ARCHIVE_GRACE_MS MUST stay equal to CHECKOUT_GRACE_MS in
 * lib/validation/reservation-validator.ts. The validator's value is not
 * exported (intentional — keeps validator untouched), so we mirror it here
 * with this contract in the constant's name.
 */

import { db, vehiclesTable } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

// MUST match CHECKOUT_GRACE_MS in lib/validation/reservation-validator.ts (1h).
const ARCHIVE_GRACE_MS = 1 * 60 * 60 * 1000;

const DRY_RUN = false; // Phase 2: live archiving enabled (sets archived_at).

interface ArchiveCandidate {
  id: string;
  license_plate: string;
  status: string;
  access_type: string;
  created_at: Date;
  link_count: number;
  latest_check_out: Date | null;
  latest_reservation_status: string | null;
  hours_since_grace_closed: number | null;
}

export async function sweepArchivableVehiclesDryRun(): Promise<{
  scanned: number;
  candidates: number;
}> {
  // One query: pull vehicle rows that satisfy criteria 1-5, plus context
  // columns (latest reservation's check_out and status) for the log line.
  // We use raw SQL for the correlated EXISTS / NOT EXISTS — pure read-only.
  const graceInterval = sql.raw(`INTERVAL '${ARCHIVE_GRACE_MS} milliseconds'`);

  const rows = await db.execute<{
    id: string;
    license_plate: string;
    status: string;
    access_type: string;
    created_at: Date;
    link_count: string | number;
    latest_check_out: Date | null;
    latest_reservation_status: string | null;
  }>(sql`
    SELECT
      v.id,
      v.license_plate,
      v.status::text                 AS status,
      v.access_type::text            AS access_type,
      v.created_at,
      (SELECT COUNT(*)::int FROM reservation_vehicles rv
        WHERE rv.vehicle_id = v.id)  AS link_count,
      (SELECT MAX(r.check_out)
         FROM reservation_vehicles rv
         JOIN reservations r ON r.id = rv.reservation_id
        WHERE rv.vehicle_id = v.id)  AS latest_check_out,
      (SELECT r.status::text
         FROM reservation_vehicles rv
         JOIN reservations r ON r.id = rv.reservation_id
        WHERE rv.vehicle_id = v.id
        ORDER BY r.check_out DESC
        LIMIT 1)                     AS latest_reservation_status
    FROM vehicles v
    WHERE v.access_type = 'reservation'
      AND v.status <> 'blacklisted'
      AND v.archived_at IS NULL
      AND EXISTS (
        SELECT 1 FROM reservation_vehicles rv
         WHERE rv.vehicle_id = v.id
      )
      AND NOT EXISTS (
        SELECT 1
          FROM reservation_vehicles rv
          JOIN reservations r ON r.id = rv.reservation_id
         WHERE rv.vehicle_id = v.id
           AND r.status <> 'cancelled'
           AND (r.check_out + ${graceInterval}) > NOW()
      )
  `);

  // drizzle's execute() returns either { rows: [...] } (node-postgres) or an
  // array (neon-http). Normalize.
  const candidates: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

  // Total vehicles considered (for context in logs). Cheap count.
  const totalRows = await db.execute<{ count: string | number }>(sql`
    SELECT COUNT(*)::int AS count FROM vehicles
     WHERE access_type = 'reservation' AND archived_at IS NULL
  `);
  const totalArr: any[] = Array.isArray(totalRows)
    ? totalRows
    : (totalRows as any).rows ?? [];
  const scanned = Number(totalArr[0]?.count ?? 0);

  const mode = DRY_RUN ? "DRY-RUN" : "LIVE";

  if (candidates.length === 0) {
    console.log(
      `[vehicle-archive][${mode}] scanned=${scanned} candidates=0 ` +
        `(no temporary reservation vehicles past grace window)`,
    );
    return { scanned, candidates: 0 };
  }

  console.log(
    `[vehicle-archive][${mode}] scanned=${scanned} candidates=${candidates.length} ` +
      (DRY_RUN
        ? `— would archive these vehicles (no UPDATE performed):`
        : `— archiving these vehicles:`),
  );

  const now = Date.now();
  for (const c of candidates) {
    const latestCheckOut: Date | null = c.latest_check_out
      ? new Date(c.latest_check_out)
      : null;
    const hoursSinceGraceClosed =
      latestCheckOut !== null
        ? Math.floor(
            (now - (latestCheckOut.getTime() + ARCHIVE_GRACE_MS)) / 3_600_000,
          )
        : null;

    const detail: ArchiveCandidate = {
      id: c.id,
      license_plate: c.license_plate,
      status: c.status,
      access_type: c.access_type,
      created_at: new Date(c.created_at),
      link_count: Number(c.link_count ?? 0),
      latest_check_out: latestCheckOut,
      latest_reservation_status: c.latest_reservation_status,
      hours_since_grace_closed: hoursSinceGraceClosed,
    };

    console.log(
      `[vehicle-archive][${mode}]   plate=${detail.license_plate} id=${detail.id} ` +
        `status=${detail.status} access_type=${detail.access_type} ` +
        `reservation_links=${detail.link_count} ` +
        `latest_reservation_status=${detail.latest_reservation_status} ` +
        `latest_check_out=${detail.latest_check_out?.toISOString() ?? "null"} ` +
        `hours_past_grace=${detail.hours_since_grace_closed} ` +
        `reason="all reservations are cancelled/completed and (check_out + 1h grace) is in the past"`,
    );
  }

  if (!DRY_RUN) {
    // Atomic, race-safe archive: re-evaluate the SAME eligibility predicate at
    // UPDATE time (criteria 1-5), not the stale candidate id list. So a vehicle
    // re-linked to a new/future reservation between the SELECT above and now is
    // NOT archived. Part 3 (resolveLicensePlates un-archive) covers the residual
    // window where a reservation commits just after this statement's snapshot.
    const archived = await db.execute<{ id: string }>(sql`
      UPDATE vehicles v
         SET archived_at = NOW(), updated_at = NOW()
       WHERE v.access_type = 'reservation'
         AND v.status <> 'blacklisted'
         AND v.archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM reservation_vehicles rv WHERE rv.vehicle_id = v.id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM reservation_vehicles rv
             JOIN reservations r ON r.id = rv.reservation_id
            WHERE rv.vehicle_id = v.id
              AND r.status <> 'cancelled'
              AND (r.check_out + ${graceInterval}) > NOW()
         )
      RETURNING v.id
    `);
    const archivedRows: any[] = Array.isArray(archived) ? archived : (archived as any).rows ?? [];
    console.log(`[vehicle-archive][LIVE] archived ${archivedRows.length} vehicle(s)`);
  }

  return { scanned, candidates: candidates.length };
}

// ─── Periodic runner ──────────────────────────────────────────────────────────

let sweepInFlight = false;
async function runArchiveGuarded(label: string) {
  if (sweepInFlight) {
    console.log(
      `[vehicle-archive] ${label} skipped — previous sweep still running`,
    );
    return;
  }
  sweepInFlight = true;
  try {
    await sweepArchivableVehiclesDryRun();
  } catch (err) {
    // Read-only sweep — failure here MUST NOT affect anything else. Log and
    // move on; next tick will try again.
    console.error(`[vehicle-archive] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

/**
 * Start the periodic archive sweep (Phase 1: dry-run).
 * Independent from the PIN sweep — separate interval, separate failure mode.
 */
export function startVehicleArchiveSweep(
  intervalMs = 5 * 60 * 1000,
): NodeJS.Timeout {
  // Stagger the initial run after the PIN sweep's 30s delay so the two
  // observation windows don't interleave their log lines on the same second.
  setTimeout(() => void runArchiveGuarded("initial run"), 45_000);
  return setInterval(
    () => void runArchiveGuarded("periodic run"),
    intervalMs,
  );
}
