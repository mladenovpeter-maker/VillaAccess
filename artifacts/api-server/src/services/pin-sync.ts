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
import { eq } from "drizzle-orm";
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

/** Short stable employee number derived from reservation ID (≤32 chars for Hik API). */
function toEmployeeNo(reservationId: string): string {
  return `RES_${reservationId.replace(/-/g, "").slice(0, 24)}`;
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

  await db
    .update(reservationsTable)
    .set({ pin_sync_status: "revoked", pin_last_synced_at: new Date(), updated_at: new Date() })
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
