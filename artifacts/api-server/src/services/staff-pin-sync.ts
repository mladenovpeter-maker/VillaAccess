/**
 * Staff PIN Sync — standalone (non-reservation) temp credentials.
 *
 * Mirror of pin-sync.ts but for `temp_credentials` rows that are NOT tied to a
 * reservation (owner_name set, reservation_id NULL). These are staff PINs:
 *   - "temporary" — cleaner / gardener, window-bound (valid_from..valid_until)
 *   - "permanent" — manager / owner, far-future valid_until sentinel
 *
 * Scope decision (per product owner): standalone PINs are pushed to Hikvision
 * intercoms ONLY — never to Tuya smart locks. We therefore reuse the exact same
 * device endpoint (HikvisionIntercomService) and target set (all
 * pin_sync_enabled intercoms) as the reservation flow, WITHOUT touching the
 * reservation path in pin-sync.ts.
 *
 * The device user is keyed by a numeric employeeNo derived from the credential
 * id (namespaced with a "cred:" prefix so it can never collide with a
 * reservation-derived employeeNo). Revoke is deterministic from the credential
 * id alone — no separate ledger table is needed.
 *
 * Hikvision DS-K terminals natively enforce the Valid.endTime window, so an
 * expired temporary PIN is rejected at the keypad even before the housekeeping
 * sweep removes the device user record.
 */

import { db } from "@workspace/db";
import { intercomsTable, tempCredentialsTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { HikvisionIntercomService } from "./hikvision/intercom";
import { eventBus } from "../lib/events";

export interface StaffSyncResult {
  intercom_id: string;
  intercom_name: string;
  success: boolean;
  error?: string;
}

export interface StaffSyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: StaffSyncResult[];
  overall_status: "synced" | "failed" | "partial" | "not_applicable";
}

export interface StaffCredential {
  id: string;
  owner_name: string | null;
  label: string | null;
  pin_code: string;
  valid_from: Date;
  valid_until: Date;
}

// Numeric-only employeeNo, namespaced so it can never collide with a
// reservation-derived one (see pin-sync.toEmployeeNo).
function toEmployeeNo(credentialId: string): string {
  const hash = createHash("sha256").update(`cred:${credentialId}`).digest("hex");
  return BigInt("0x" + hash.slice(0, 14)).toString(10);
}

// Hikvision DS-K terminals use a 32-bit time_t and reject any endTime beyond
// the Y2038 boundary. "Permanent" PINs carry a far-future sentinel (year 2099)
// in the DB, which the device refuses → the whole push fails. Cap the
// device-side endTime to a safe in-2037 value (kept comfortably inside 2037
// across all server timezones). The DB row is untouched — it stays permanent.
const HIK_MAX_VALID_TO = new Date("2037-12-30T12:00:00Z");
function deviceValidTo(validUntil: Date): Date {
  return validUntil.getTime() > HIK_MAX_VALID_TO.getTime() ? HIK_MAX_VALID_TO : validUntil;
}

async function getSyncTargets() {
  // Only Hikvision intercoms can receive PINs — filter at the query so
  // non-Hikvision devices never count toward sync_status as "failed".
  return db
    .select()
    .from(intercomsTable)
    .where(and(eq(intercomsTable.pin_sync_enabled, true), eq(intercomsTable.protocol, "hikvision")));
}

function displayName(cred: StaffCredential): string {
  return cred.owner_name || cred.label || "Персонал";
}

/**
 * Push a standalone staff PIN to all sync-enabled Hikvision intercoms and
 * record the result in temp_credentials.sync_status.
 */
export async function syncCredentialToIntercoms(
  cred: StaffCredential,
  operatorId?: string,
): Promise<StaffSyncSummary> {
  if (!cred.pin_code) {
    await db.update(tempCredentialsTable).set({ sync_status: "failed" }).where(eq(tempCredentialsTable.id, cred.id));
    return { total: 0, succeeded: 0, failed: 0, results: [], overall_status: "failed" };
  }

  const employeeNo = toEmployeeNo(cred.id);
  const intercoms = await getSyncTargets();

  console.log(`[staff-pin-sync] ──────────────────────────────────────────────`);
  console.log(`[staff-pin-sync] credential=${cred.id}  owner="${displayName(cred)}"`);
  console.log(`[staff-pin-sync] employeeNo=${employeeNo}  (length=${employeeNo.length})`);
  console.log(`[staff-pin-sync] validFrom=${cred.valid_from.toISOString()}  →  ${cred.valid_until.toISOString()}`);
  console.log(`[staff-pin-sync] targets: ${intercoms.length} intercom(s) [${intercoms.map((i) => i.name).join(", ")}]`);

  if (intercoms.length === 0) {
    await db.update(tempCredentialsTable).set({ sync_status: "not_applicable" }).where(eq(tempCredentialsTable.id, cred.id));
    return { total: 0, succeeded: 0, failed: 0, results: [], overall_status: "not_applicable" };
  }

  const results: StaffSyncResult[] = await Promise.all(
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
        guestName: displayName(cred),
        pin:       cred.pin_code,
        validFrom: cred.valid_from,
        validTo:   deviceValidTo(cred.valid_until),
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
  const overall_status: StaffSyncSummary["overall_status"] =
    succeeded === results.length ? "synced" :
    succeeded === 0 ? "failed" : "partial";

  await db
    .update(tempCredentialsTable)
    .set({ sync_status: overall_status })
    .where(eq(tempCredentialsTable.id, cred.id));

  void eventBus.publish({
    event_type: "reservation.pin_synced",
    category:   "reservation",
    severity:   overall_status === "failed" ? "warning" : "info",
    operator_id: operatorId,
    source:     "staff-pin-sync",
    payload: {
      credential_id:    cred.id,
      pin_sync_status:  overall_status,
      intercoms_total:  results.length,
      intercoms_synced: succeeded,
      intercoms_failed: failed,
    },
  });

  return { total: results.length, succeeded, failed, results, overall_status };
}

/**
 * Revoke a standalone staff PIN from all sync-enabled intercoms.
 * Best-effort: callers may still proceed (revoke/delete) on failure.
 */
export async function revokeCredentialFromIntercoms(
  cred: { id: string },
  operatorId?: string,
): Promise<StaffSyncSummary> {
  const employeeNo = toEmployeeNo(cred.id);
  const intercoms  = await getSyncTargets();

  const results: StaffSyncResult[] = await Promise.all(
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
      return { intercom_id: ic.id, intercom_name: ic.name, success: r.success, error: r.error };
    }),
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;
  const overall   = succeeded === results.length ? "synced" : succeeded === 0 ? "failed" : "partial";

  void eventBus.publish({
    event_type: "reservation.pin_revoked",
    category:   "reservation",
    severity:   "info",
    operator_id: operatorId,
    source:     "staff-pin-sync",
    payload: { credential_id: cred.id, revoked_from: succeeded, failed },
  });

  return { total: results.length, succeeded, failed, results, overall_status: overall };
}

// ─── Expiry sweep (standalone only) ───────────────────────────────────────────

/**
 * Housekeeping: revoke device records for standalone temporary PINs whose
 * window has passed, and flip their status to 'expired'. Permanent PINs carry
 * a far-future valid_until sentinel so they are never swept. Reservation-linked
 * rows (reservation_id NOT NULL) are ignored here — they are handled by the
 * reservation pin-sweep and never pushed by this service.
 *
 * Like the reservation sweep this is housekeeping, not a security control:
 * Hikvision enforces the validity window natively at the keypad.
 */
export async function sweepExpiredStandaloneCredentials(): Promise<{ scanned: number; revoked: number; failed: number }> {
  const now = new Date();

  const due = await db
    .select()
    .from(tempCredentialsTable)
    .where(
      and(
        isNull(tempCredentialsTable.reservation_id),
        eq(tempCredentialsTable.status, "active"),
        eq(tempCredentialsTable.access_type, "temporary"),
        lt(tempCredentialsTable.valid_until, now),
      ),
    );

  if (due.length === 0) return { scanned: 0, revoked: 0, failed: 0 };
  console.log(`[staff-pin-sweep] ${due.length} expired standalone PIN(s) to revoke`);

  let revoked = 0, failed = 0;
  for (const c of due) {
    try {
      const r = await revokeCredentialFromIntercoms({ id: c.id });
      await db
        .update(tempCredentialsTable)
        .set({ status: "expired", sync_status: r.failed === 0 ? "revoked" : "failed" })
        .where(eq(tempCredentialsTable.id, c.id));
      if (r.failed === 0) revoked++; else failed++;
    } catch (err) {
      console.error(`[staff-pin-sweep] revoke threw for ${c.id}:`, err);
      failed++;
    }
  }
  console.log(`[staff-pin-sweep] done: revoked=${revoked} failed=${failed}`);
  return { scanned: due.length, revoked, failed };
}

let sweepInFlight = false;
async function runSweepGuarded(label: string) {
  if (sweepInFlight) {
    console.log(`[staff-pin-sweep] ${label} skipped — previous sweep still running`);
    return;
  }
  sweepInFlight = true;
  try {
    await sweepExpiredStandaloneCredentials();
  } catch (err) {
    console.error(`[staff-pin-sweep] ${label} failed:`, err);
  } finally {
    sweepInFlight = false;
  }
}

export function startStaffPinExpirySweep(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  setTimeout(() => void runSweepGuarded("initial run"), 40_000);
  return setInterval(() => void runSweepGuarded("periodic run"), intervalMs);
}
