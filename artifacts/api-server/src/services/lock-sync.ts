/**
 * Lock Sync Orchestrator — mirror of pin-sync.ts for smart locks.
 *
 * The backend is the single source of truth for reservation PINs. This
 * service pushes the SAME PIN that pin-sync pushes to Hikvision intercoms
 * out to the per-villa Tuya smart lock (and any future protocols).
 *
 * Per-villa model (Phase 2):
 *   * Each reservation has exactly one villa.
 *   * Each villa has 0 or 1 smart_lock row (enforced by UNIQUE INDEX on
 *     smart_locks.villa_id).
 *   * So each reservation gets at most one smart-lock temp-password row
 *     in smart_lock_passwords.
 *
 * Flow:
 *   syncPinToLocks(reservation)
 *     → find the villa's smart lock (if any)
 *     → revoke any prior 'active' password rows for this reservation
 *       (defensive — handles re-sync after PIN regen)
 *     → call adapter.createTempPassword({pin, name, valid_from, valid_to})
 *     → insert smart_lock_passwords row (status='active')
 *
 *   revokePinFromLocks(reservation)
 *     → fetch all 'active' or 'failed' rows for this reservation
 *     → call adapter.deleteTempPassword(provider_password_id) for each
 *     → update row status='revoked' (or 'failed' on error)
 *
 * Tuya is OPTIONAL: if isTuyaConfigured() is false OR the villa has no
 * smart lock assigned, the orchestrator returns total=0 immediately and
 * does NOT log a warning — the same reservation may have an intercom PIN
 * pushed successfully even without a lock.
 */

import { db } from "@workspace/db";
import {
  smartLocksTable,
  smartLockPasswordsTable,
  reservationsTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { createLockAdapter } from "../lib/locks/factory";
import { isTuyaConfigured, TuyaConfigError } from "../lib/locks/tuya/client";
import { eventBus } from "../lib/events";

export interface LockSyncResult {
  smart_lock_id: string;
  smart_lock_name: string;
  success: boolean;
  provider_password_id?: string;
  error?: string;
}

export interface LockSyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: LockSyncResult[];
  overall_status: "synced" | "failed" | "partial" | "not_applicable";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the (at most one) smart lock that should receive this
 * reservation's PIN. Returns null if the villa has no lock OR Tuya is
 * not configured — both are non-error conditions (the deployment may
 * use intercoms only).
 */
async function getLockForReservation(villaId: string) {
  const rows = await db
    .select()
    .from(smartLocksTable)
    .where(eq(smartLocksTable.villa_id, villaId))
    .limit(1);
  return rows[0] ?? null;
}

function notApplicable(): LockSyncSummary {
  return { total: 0, succeeded: 0, failed: 0, results: [], overall_status: "not_applicable" };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Push a reservation PIN to the villa's smart lock as a temp-password.
 * Returns 'not_applicable' (no-op) when there's no lock or Tuya is off.
 */
export async function syncPinToLocks(
  reservation: {
    id: string;
    villa_id: string;
    guest_name: string;
    pin_code: string | null;
    pin_valid_from: Date | null;
    pin_valid_to: Date | null;
    check_in: Date;
    check_out: Date;
  },
  operatorId?: string,
): Promise<LockSyncSummary> {
  if (!reservation.pin_code) return notApplicable();
  if (!isTuyaConfigured()) return notApplicable();

  const lock = await getLockForReservation(reservation.villa_id);
  if (!lock) return notApplicable();

  const validFrom = reservation.pin_valid_from ?? reservation.check_in;
  const validTo   = reservation.pin_valid_to   ?? reservation.check_out;

  console.log(`[lock-sync] ──────────────────────────────────────────────────`);
  console.log(`[lock-sync] reservation=${reservation.id}  guest="${reservation.guest_name}"`);
  console.log(`[lock-sync] lock=${lock.name} (${lock.id})  protocol=${lock.protocol}`);
  console.log(`[lock-sync] pin=${reservation.pin_code}  ${validFrom.toISOString()} → ${validTo.toISOString()}`);

  // Defensive: revoke any prior active password for this reservation on
  // this lock — handles re-sync after PIN regen or date change.
  await revokeActiveRowsForReservation(reservation.id, lock.id, operatorId);

  let result: LockSyncResult;
  try {
    const adapter = createLockAdapter(lock);
    const created = await adapter.createTempPassword({
      pin:        reservation.pin_code,
      name:       reservation.guest_name,
      valid_from: validFrom,
      valid_to:   validTo,
    });
    await db.insert(smartLockPasswordsTable).values({
      reservation_id:       reservation.id,
      smart_lock_id:        lock.id,
      provider_password_id: created.password_id,
      status:               "active",
    });
    result = {
      smart_lock_id:        lock.id,
      smart_lock_name:      lock.name,
      success:              true,
      provider_password_id: created.password_id,
    };
    console.log(`[lock-sync] ✓ pushed — provider_password_id=${created.password_id}`);
  } catch (err) {
    const msg = err instanceof TuyaConfigError
      ? err.message
      : (err as Error)?.message ?? "Unknown error";
    result = { smart_lock_id: lock.id, smart_lock_name: lock.name, success: false, error: msg };
    console.error(`[lock-sync] ✗ failed:`, msg);
  }

  const summary: LockSyncSummary = {
    total: 1,
    succeeded: result.success ? 1 : 0,
    failed:    result.success ? 0 : 1,
    results: [result],
    overall_status: result.success ? "synced" : "failed",
  };

  void eventBus.publish({
    event_type:     "reservation.pin_synced",
    category:       "reservation",
    severity:       result.success ? "info" : "warning",
    reservation_id: reservation.id,
    operator_id:    operatorId,
    source:         "lock-sync",
    payload: {
      lock_sync_status: summary.overall_status,
      smart_lock_id:    lock.id,
      smart_lock_name:  lock.name,
      ...(result.error ? { error: result.error } : {}),
    },
  });

  return summary;
}

/**
 * Revoke a reservation's temp-password from the villa's smart lock.
 * Returns 'not_applicable' if no lock or Tuya is off.
 */
export async function revokePinFromLocks(
  reservation: { id: string },
  operatorId?: string,
): Promise<LockSyncSummary> {
  if (!isTuyaConfigured()) return notApplicable();
  const summary = await revokeActiveRowsForReservation(reservation.id, null, operatorId);

  void eventBus.publish({
    event_type:     "reservation.pin_revoked",
    category:       "reservation",
    severity:       summary.failed > 0 ? "warning" : "info",
    reservation_id: reservation.id,
    operator_id:    operatorId,
    source:         "lock-sync",
    payload: { revoked: summary.succeeded, failed: summary.failed },
  });

  return summary;
}

/**
 * Internal: revoke every 'active' or 'failed' smart_lock_passwords row
 * for this reservation, optionally restricted to a single lock id.
 * Used by both revokePinFromLocks (lifecycle) and syncPinToLocks
 * (defensive pre-create cleanup).
 */
async function revokeActiveRowsForReservation(
  reservationId: string,
  onlyLockId: string | null,
  _operatorId?: string,
): Promise<LockSyncSummary> {
  const conds = [
    eq(smartLockPasswordsTable.reservation_id, reservationId),
    inArray(smartLockPasswordsTable.status, ["active", "failed"]),
  ];
  if (onlyLockId) conds.push(eq(smartLockPasswordsTable.smart_lock_id, onlyLockId));

  const rows = await db
    .select({
      id:                   smartLockPasswordsTable.id,
      smart_lock_id:        smartLockPasswordsTable.smart_lock_id,
      provider_password_id: smartLockPasswordsTable.provider_password_id,
    })
    .from(smartLockPasswordsTable)
    .where(and(...conds));

  if (rows.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, results: [], overall_status: "not_applicable" };
  }

  // Pre-load all the relevant lock rows in one shot.
  const lockIds = [...new Set(rows.map((r) => r.smart_lock_id))];
  const locks = await db
    .select()
    .from(smartLocksTable)
    .where(inArray(smartLocksTable.id, lockIds));
  const locksById = new Map(locks.map((l) => [l.id, l]));

  const results: LockSyncResult[] = await Promise.all(
    rows.map(async (r) => {
      const lock = locksById.get(r.smart_lock_id);
      if (!lock) {
        await db
          .update(smartLockPasswordsTable)
          .set({ status: "revoked", revoked_at: new Date(), last_error: "lock row missing" })
          .where(eq(smartLockPasswordsTable.id, r.id));
        return { smart_lock_id: r.smart_lock_id, smart_lock_name: "(deleted)", success: true };
      }
      try {
        const adapter = createLockAdapter(lock);
        await adapter.deleteTempPassword(r.provider_password_id);
        await db
          .update(smartLockPasswordsTable)
          .set({ status: "revoked", revoked_at: new Date(), last_error: null })
          .where(eq(smartLockPasswordsTable.id, r.id));
        return { smart_lock_id: lock.id, smart_lock_name: lock.name, success: true };
      } catch (err) {
        const msg = (err as Error)?.message ?? "Unknown error";
        await db
          .update(smartLockPasswordsTable)
          .set({ status: "failed", last_error: msg.slice(0, 1024) })
          .where(eq(smartLockPasswordsTable.id, r.id));
        return { smart_lock_id: lock.id, smart_lock_name: lock.name, success: false, error: msg };
      }
    }),
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;
  const overall: LockSyncSummary["overall_status"] =
    failed === 0 ? "synced" :
    succeeded === 0 ? "failed" : "partial";

  return { total: results.length, succeeded, failed, results, overall_status: overall };
}

// ─── Expiry sweep ────────────────────────────────────────────────────────────

/**
 * Sweep expired/cancelled/completed reservations and revoke any smart-lock
 * passwords still marked 'active' or 'failed'.
 *
 * Same housekeeping rationale as pin-sync.sweepExpiredPins() — Tuya
 * temp-passwords with invalid_time in the past won't unlock the door,
 * but cleaning them keeps the Smart Life app tidy and frees the
 * device-side password slots (Tuya locks cap temp-passwords per device).
 */
export async function sweepExpiredLockPasswords(): Promise<{ scanned: number; revoked: number; failed: number }> {
  if (!isTuyaConfigured()) return { scanned: 0, revoked: 0, failed: 0 };
  const now = new Date();

  // Join smart_lock_passwords with reservations to filter due rows in one go.
  const candidates = await db
    .select({
      pwd_id:               smartLockPasswordsTable.id,
      reservation_id:       smartLockPasswordsTable.reservation_id,
      smart_lock_id:        smartLockPasswordsTable.smart_lock_id,
      provider_password_id: smartLockPasswordsTable.provider_password_id,
      reservation_status:   reservationsTable.status,
      pin_valid_to:         reservationsTable.pin_valid_to,
    })
    .from(smartLockPasswordsTable)
    .innerJoin(reservationsTable, eq(reservationsTable.id, smartLockPasswordsTable.reservation_id))
    .where(
      and(
        inArray(smartLockPasswordsTable.status, ["active", "failed"]),
        isNotNull(smartLockPasswordsTable.provider_password_id),
      ),
    );

  const due = candidates.filter((c) => {
    if (c.reservation_status === "cancelled" || c.reservation_status === "completed") return true;
    if (c.pin_valid_to && c.pin_valid_to.getTime() < now.getTime()) return true;
    return false;
  });

  if (due.length === 0) return { scanned: candidates.length, revoked: 0, failed: 0 };
  console.log(`[lock-sweep] ${due.length} expired/orphaned lock-password(s) to revoke (of ${candidates.length})`);

  // Group by reservation_id so revokeActiveRowsForReservation handles each.
  const byResv = new Map<string, true>();
  for (const c of due) byResv.set(c.reservation_id, true);

  let revoked = 0, failed = 0;
  for (const reservation_id of byResv.keys()) {
    try {
      const r = await revokeActiveRowsForReservation(reservation_id, null);
      if (r.failed === 0) revoked++;
      else failed++;
    } catch (err) {
      console.error(`[lock-sweep] revoke threw for reservation ${reservation_id}:`, err);
      failed++;
    }
  }
  console.log(`[lock-sweep] done: revoked=${revoked} failed=${failed}`);
  return { scanned: candidates.length, revoked, failed };
}

let sweepInFlight = false;
async function runSweepGuarded(label: string) {
  if (sweepInFlight) {
    console.log(`[lock-sweep] ${label} skipped — previous sweep still running`);
    return;
  }
  sweepInFlight = true;
  try {
    await sweepExpiredLockPasswords();
  } catch (err) {
    console.error(`[lock-sweep] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

export function startLockExpirySweep(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  setTimeout(() => void runSweepGuarded("initial run"), 45_000);
  return setInterval(() => void runSweepGuarded("periodic run"), intervalMs);
}
