/**
 * Vehicle access validator — MakmetalAccess (Phase 2).
 *
 * Access policy (in priority order):
 *   1. Blacklisted vehicles → always denied.
 *   2. Permanent-access vehicles (staff/owner) → always allowed.
 *   3. Vehicle linked to a worker → check access_rules for this worker+entrance.
 *      If a shift is attached to the rule, verify current time/day.
 *   4. All other vehicles → denied (NO_REGISTRATION).
 */

import { db } from "@workspace/db";
import {
  vehiclesTable,
  workerVehiclesTable,
  accessRulesTable,
  shiftsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  denial_code?: string;
}

// ─── Shift helpers ────────────────────────────────────────────────────────────

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isWithinShift(shift: { start_time: string; end_time: string; days_of_week: number[] }): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (!shift.days_of_week.includes(day)) return false;

  const start = timeToMinutes(shift.start_time);
  const end = timeToMinutes(shift.end_time);

  // Handle overnight shifts (e.g. 22:00 – 06:00)
  if (end < start) {
    return currentMinutes >= start || currentMinutes < end;
  }
  return currentMinutes >= start && currentMinutes < end;
}

// ─── Core access validator ────────────────────────────────────────────────────

export async function validateVehicleAccess(
  vehicleId: string,
  entranceId?: string,
): Promise<AccessDecision> {
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId))
    .limit(1);

  const vehicle = rows[0];
  if (!vehicle) {
    return {
      allowed: false,
      reason: "Vehicle not found in system",
      denial_code: "VEHICLE_NOT_FOUND",
    };
  }

  // 1. Blacklist check
  if (vehicle.status === "blacklisted") {
    return {
      allowed: false,
      reason: `Vehicle is blacklisted${vehicle.blacklist_reason ? `: ${vehicle.blacklist_reason}` : ""}`,
      denial_code: "BLACKLISTED",
    };
  }

  // 2. Permanent-access bypass
  if ((vehicle as any).access_type === "permanent") {
    return {
      allowed: true,
      reason: "Permanent access vehicle",
    };
  }

  // 3. Worker-based access
  // Find all workers this vehicle is linked to
  const workerLinks = await db
    .select()
    .from(workerVehiclesTable)
    .where(eq(workerVehiclesTable.vehicle_id, vehicleId));

  if (workerLinks.length === 0) {
    return {
      allowed: false,
      reason: "Vehicle is not registered for access",
      denial_code: "NO_REGISTRATION",
    };
  }

  const workerIds = workerLinks.map((l) => l.worker_id);

  // If no entrance context → grant (manual/dashboard check)
  if (!entranceId) {
    return { allowed: true, reason: "Worker vehicle (no entrance scope)" };
  }

  // Check access rules for any of the linked workers at this entrance
  const allRules = await db
    .select()
    .from(accessRulesTable);

  const matchingRules = allRules.filter(
    (r) => workerIds.includes(r.worker_id) && r.entrance_id === entranceId,
  );

  if (matchingRules.length === 0) {
    return {
      allowed: false,
      reason: "No access rule for this worker at this entrance",
      denial_code: "NO_ACCESS_RULE",
    };
  }

  // Any rule without a shift = 24/7 access → immediate allow
  const unrestricted = matchingRules.find((r) => !r.shift_id);
  if (unrestricted) {
    return { allowed: true, reason: "Worker access — unrestricted" };
  }

  // All matching rules have a shift — check if ANY shift is currently active
  const shiftIds = [...new Set(matchingRules.map((r) => r.shift_id!))];
  const shifts = await db
    .select()
    .from(shiftsTable);

  const matchingShifts = shifts.filter((s) => shiftIds.includes(s.id) && s.active);

  for (const shift of matchingShifts) {
    if (isWithinShift(shift as any)) {
      return { allowed: true, reason: `Worker access — shift: ${shift.name}` };
    }
  }

  return {
    allowed: false,
    reason: "Outside of allowed shift hours",
    denial_code: "OUTSIDE_SHIFT",
  };
}

/**
 * Multi-entrance variant — kept for ANPR / AI-fallback compatibility.
 * Passes the first entrance ID if provided.
 */
export async function validateVehicleAccessMulti(
  vehicleId: string,
  entranceIds: string[] = [],
): Promise<AccessDecision & { matched_villa_id?: string | null }> {
  const entranceId = entranceIds[0];
  const decision = await validateVehicleAccess(vehicleId, entranceId);
  return { ...decision, matched_villa_id: null };
}

// ─── Stub validators kept for import compatibility ────────────────────────────

export async function validateVehicles(
  vehicleIds: string[],
): Promise<{ errors: ValidationError[]; warnings: string[] }> {
  if (!vehicleIds.length) return { errors: [], warnings: [] };

  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const vehicles = await db.select().from(vehiclesTable);

  const found = new Set(vehicles.map((v) => v.id));
  for (const id of vehicleIds) {
    if (!found.has(id)) {
      errors.push({ field: "vehicle_ids", code: "VEHICLE_NOT_FOUND", message: `Vehicle ${id} not found` });
    }
  }
  for (const v of vehicles.filter((v) => vehicleIds.includes(v.id))) {
    if (v.status === "blacklisted") {
      warnings.push(`Vehicle ${v.license_plate} is blacklisted. Access will require manual override.`);
    }
  }
  return { errors, warnings };
}
