/**
 * Vehicle archive sweep — MakmetalAccess Phase 1.
 *
 * In the industrial site context there are no reservations.
 * Vehicles are permanently registered workers / known visitors.
 * This sweep is a no-op placeholder; Phase 2 will introduce
 * work-schedule-based archiving when that feature is built.
 */

export async function sweepArchivableVehiclesDryRun(): Promise<{
  scanned: number;
  candidates: number;
}> {
  // No-op: reservations table was removed in Phase 1 migration.
  // There are no temporary/reservation-type vehicles to archive.
  return { scanned: 0, candidates: 0 };
}

// ─── Periodic runner ──────────────────────────────────────────────────────────

let sweepInFlight = false;

async function runArchiveGuarded(label: string) {
  if (sweepInFlight) {
    return;
  }
  sweepInFlight = true;
  try {
    await sweepArchivableVehiclesDryRun();
  } catch (err) {
    console.error(`[vehicle-archive] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

/**
 * Start the periodic archive sweep.
 * Currently a no-op; will be wired to work schedules in a future phase.
 */
export function startVehicleArchiveSweep(
  intervalMs = 5 * 60 * 1000,
): NodeJS.Timeout {
  return setInterval(
    () => void runArchiveGuarded("periodic run"),
    intervalMs,
  );
}
