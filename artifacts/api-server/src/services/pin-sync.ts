/**
 * PIN Sync Orchestrator
 *
 * The backend is the single source of truth for:
 *   - reservation lifecycle
 *   - PIN lifecycle
 *   - validity windows
 *   - sync state
 *
 * Hikvision intercom devices are execution endpoints only.
 *
 * Flow:
 *   syncPinToIntercoms(reservation)
 *     → get all intercoms with pin_sync_enabled = true
 *     → call HikvisionIntercomService.pushPin() for each
 *     → update reservation.pin_sync_status + pin_last_synced_at
 *     → update intercom.last_sync_status + last_sync_at
 *
 *   revokePinFromIntercoms(reservation)
 *     → call HikvisionIntercomService.revokePin() for each intercom
 *     → update reservation.pin_sync_status = "revoked"
 */

import { db } from "@workspace/db";
import { intercomsTable, reservationsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { HikvisionIntercomService } from "./hikvision/intercom";
import { eventBus } from "../lib/events";

export interface SyncResult {
  intercom_id: string;
  intercom_name: string;
  success: boolean;
  error?: string;
}

export interface PinSyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: SyncResult[];
  overall_status: "synced" | "failed" | "partial";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Numeric-only employeeNo derived deterministically from the reservation UUID.
 *
 * Hikvision firmware on DS-K1T terminals requires employeeNo to be numeric-only;
 * non-numeric characters (letters, underscores) cause the device to silently
 * reject the UserInfo even when the HTTP layer returns 200.
 *
 * We SHA-256 the reservation UUID and take the first 56 bits → up to 17 decimal
 * digits. Stable per reservation (idempotent for re-sync), unique in practice,
 * and well within Hik's 32-char employeeNo limit.
 */
function toEmployeeNo(reservationId: string): string {
  const hash = createHash("sha256").update(reservationId).digest("hex");
  return BigInt("0x" + hash.slice(0, 14)).toString(10);
}

/** Fetch all intercoms that should receive PIN pushes. */
async function getSyncTargets() {
  return db
    .select()
    .from(intercomsTable)
    .where(eq(intercomsTable.pin_sync_enabled, true));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push a reservation PIN to all sync-enabled intercoms.
 * Updates pin_sync_status on the reservation after completion.
 */
export async function syncPinToIntercoms(
  reservation: {
    id: string;
    guest_name: string;
    pin_code: string | null;
    pin_valid_from: Date | null;
    pin_valid_to: Date | null;
    check_in: Date;
    check_out: Date;
  },
  operatorId?: string,
): Promise<PinSyncSummary> {
  const pin = reservation.pin_code;
  if (!pin) {
    return { total: 0, succeeded: 0, failed: 0, results: [], overall_status: "failed" };
  }

  const validFrom = reservation.pin_valid_from ?? reservation.check_in;
  const validTo   = reservation.pin_valid_to   ?? reservation.check_out;
  const employeeNo = toEmployeeNo(reservation.id);

  const intercoms = await getSyncTargets();

  console.log(`[pin-sync] ──────────────────────────────────────────────────────`);
  console.log(`[pin-sync] reservation=${reservation.id}`);
  console.log(`[pin-sync] guest="${reservation.guest_name}"`);
  console.log(`[pin-sync] pin=${pin}`);
  console.log(`[pin-sync] employeeNo=${employeeNo}  (length=${employeeNo.length})`);
  console.log(`[pin-sync] validFrom=${validFrom.toISOString()}  →  ${validTo.toISOString()}`);
  console.log(`[pin-sync] targets: ${intercoms.length} intercom(s) [${intercoms.map((i) => i.name).join(", ")}]`);

  const results: SyncResult[] = await Promise.all(
    intercoms.map(async (ic) => {
      if (ic.protocol !== "hikvision") {
        return { intercom_id: ic.id, intercom_name: ic.name, success: false, error: "Non-Hikvision device — skipped" };
      }

      const svc = new HikvisionIntercomService({
        id:         ic.id,
        name:       ic.name,
        ip_address: ic.ip_address,
        http_port:  ic.http_port,
        username:   ic.username,
        password:   ic.password ?? "",
        relay_no:   ic.relay_no,
      });

      const r = await svc.pushPin({
        employeeNo,
        guestName: reservation.guest_name,
        pin,
        validFrom,
        validTo,
      });

      const now = new Date();
      await db
        .update(intercomsTable)
        .set({ last_sync_status: r.success ? "success" : "failed", last_sync_at: now, updated_at: now })
        .where(eq(intercomsTable.id, ic.id));

      return { intercom_id: ic.id, intercom_name: ic.name, success: r.success, error: r.error };
    }),
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;
  const overall_status: PinSyncSummary["overall_status"] =
    succeeded === results.length ? "synced" :
    succeeded === 0 ? "failed" : "partial";

  const now = new Date();
  await db
    .update(reservationsTable)
    .set({ pin_sync_status: overall_status === "synced" ? "synced" : "failed", pin_last_synced_at: now, updated_at: now })
    .where(eq(reservationsTable.id, reservation.id));

  void eventBus.publish({
    event_type:     "reservation.pin_synced",
    category:       "reservation",
    severity:       overall_status === "failed" ? "warning" : "info",
    reservation_id: reservation.id,
    operator_id:    operatorId,
    source:         "pin-sync",
    payload: {
      pin_sync_status:   overall_status,
      intercoms_total:   results.length,
      intercoms_synced:  succeeded,
      intercoms_failed:  failed,
    },
  });

  return { total: results.length, succeeded, failed, results, overall_status };
}

/**
 * Revoke a reservation PIN from all sync-enabled intercoms.
 * Updates pin_sync_status = "revoked" on the reservation.
 */
export async function revokePinFromIntercoms(
  reservation: {
    id: string;
    pin_code: string | null;
  },
  operatorId?: string,
): Promise<PinSyncSummary> {
  const employeeNo = toEmployeeNo(reservation.id);
  const intercoms  = await getSyncTargets();

  const results: SyncResult[] = await Promise.all(
    intercoms.map(async (ic) => {
      if (ic.protocol !== "hikvision") {
        return { intercom_id: ic.id, intercom_name: ic.name, success: true };
      }

      const svc = new HikvisionIntercomService({
        id:         ic.id,
        name:       ic.name,
        ip_address: ic.ip_address,
        http_port:  ic.http_port,
        username:   ic.username,
        password:   ic.password ?? "",
        relay_no:   ic.relay_no,
      });

      const r = await svc.revokePin(employeeNo);

      const now = new Date();
      await db
        .update(intercomsTable)
        .set({ last_sync_status: r.success ? "revoked" : "failed", last_sync_at: now, updated_at: now })
        .where(eq(intercomsTable.id, ic.id));

      return { intercom_id: ic.id, intercom_name: ic.name, success: r.success, error: r.error };
    }),
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;
  const overall   = succeeded === results.length ? "synced" : succeeded === 0 ? "failed" : "partial";

  // Only mark fully-revoked when every intercom succeeded. Partial/total
  // failures must remain retry-eligible so the expiry sweep can pick them up.
  await db
    .update(reservationsTable)
    .set({
      pin_sync_status:    failed === 0 ? "revoked" : "failed",
      pin_last_synced_at: new Date(),
      updated_at:         new Date(),
    })
    .where(eq(reservationsTable.id, reservation.id));

  void eventBus.publish({
    event_type:     "reservation.pin_revoked",
    category:       "reservation",
    severity:       "info",
    reservation_id: reservation.id,
    operator_id:    operatorId,
    source:         "pin-sync",
    payload: { revoked_from: succeeded, failed },
  });

  return { total: results.length, succeeded, failed, results, overall_status: overall };
}

// ─── Expiry sweep ─────────────────────────────────────────────────────────────

/**
 * Sweep expired/cancelled/completed reservations and revoke any PIN records
 * still marked as `synced` on a device.
 *
 * Note on security: Hikvision DS-K terminals natively enforce the `Valid.endTime`
 * window — a PIN whose validity has passed is rejected at the keypad even if the
 * user record still exists on the device. This sweep is therefore a *housekeeping*
 * pass, not a security control:
 *   - keeps device user-slot count low (terminals cap at ~10k users)
 *   - cleans up records left orphaned by transient revoke failures
 *     (network blips during delete/cancel/checkout)
 *   - flips reservation.pin_sync_status from "synced" → "revoked" so the
 *     dashboard reflects reality
 *
 * Idempotent: revokePin treats "no matched user" as success, so re-running is safe.
 */
export async function sweepExpiredPins(): Promise<{ scanned: number; revoked: number; failed: number }> {
  const now = new Date();

  // Candidates: flagged synced OR failed (failed = previous revoke didn't fully
  // succeed — must keep retrying), with a PIN code set. Then filter to:
  //   (a) validity window has passed, OR
  //   (b) reservation was cancelled/completed (any leftover device record is orphaned)
  const expired = await db
    .select()
    .from(reservationsTable)
    .where(
      and(
        inArray(reservationsTable.pin_sync_status, ["synced", "failed"]),
        isNotNull(reservationsTable.pin_code),
      ),
    );

  const due = expired.filter((r) => {
    if (r.status === "cancelled" || r.status === "completed") return true;
    if (r.pin_valid_to && r.pin_valid_to.getTime() < now.getTime()) return true;
    return false;
  });

  if (due.length === 0) return { scanned: expired.length, revoked: 0, failed: 0 };

  console.log(`[pin-sweep] ${due.length} expired/orphaned PIN(s) to revoke (of ${expired.length} synced)`);

  let revoked = 0;
  let failed  = 0;
  for (const r of due) {
    try {
      const result = await revokePinFromIntercoms(r);
      if (result.failed === 0) revoked++;
      else failed++;
    } catch (err) {
      console.error(`[pin-sweep] revoke threw for ${r.id}:`, err);
      failed++;
    }
  }

  console.log(`[pin-sweep] done: revoked=${revoked} failed=${failed}`);
  return { scanned: expired.length, revoked, failed };
}

/**
 * Start the periodic sweep. Safe to call once at server boot.
 * Returns the interval handle so callers can clearTimeout on shutdown if needed.
 *
 * Reentrancy: if a previous sweep is still running (e.g. device slow / many
 * expired rows), the next tick is skipped to avoid hammering the device with
 * overlapping revoke storms.
 */
let sweepInFlight = false;
async function runSweepGuarded(label: string) {
  if (sweepInFlight) {
    console.log(`[pin-sweep] ${label} skipped — previous sweep still running`);
    return;
  }
  sweepInFlight = true;
  try {
    await sweepExpiredPins();
  } catch (err) {
    console.error(`[pin-sweep] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

export function startExpirySweep(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  // Kick once shortly after boot (delayed so seeders / migrations settle), then on interval.
  setTimeout(() => void runSweepGuarded("initial run"), 30_000);
  return setInterval(() => void runSweepGuarded("periodic run"), intervalMs);
}
