/**
 * Vehicle access validator — MakmetalAccess (Phase 1).
 *
 * Reservations and villas have been removed. Access policy is now:
 *   - Blacklisted vehicles → always denied.
 *   - Permanent-access vehicles (staff/worker) → always allowed.
 *   - All other vehicles → denied (NO_REGISTRATION).
 *
 * Phase 2 will introduce role-based access matrix keyed on entrance
 * access_level. The exported function signatures are intentionally
 * kept compatible so callers (anpr.ts, ai-fallback.ts) need no changes.
 */

import { db } from "@workspace/db";
import { vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Shared types (kept compatible with previous callers) ─────────────────────

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

// ─── Core access validator ────────────────────────────────────────────────────

/**
 * Decide whether a vehicle may pass through.
 * villaId / villaIds parameters are accepted for call-site compatibility
 * but are not used in Phase 1 (no reservation scope).
 */
export async function validateVehicleAccess(
  vehicleId: string,
  _villaId?: string,
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

  if (vehicle.status === "blacklisted") {
    return {
      allowed: false,
      reason: `Vehicle is blacklisted${vehicle.blacklist_reason ? `: ${vehicle.blacklist_reason}` : ""}`,
      denial_code: "BLACKLISTED",
    };
  }

  if ((vehicle as any).access_type === "permanent") {
    return {
      allowed: true,
      reason: "Permanent access vehicle",
    };
  }

  return {
    allowed: false,
    reason: "Vehicle is not registered for access",
    denial_code: "NO_REGISTRATION",
  };
}

/**
 * Multi-villa variant — kept for ANPR / AI-fallback compatibility.
 * In Phase 1 the villaIds array is ignored; access is determined solely by
 * vehicle status (blacklist / permanent).
 */
export async function validateVehicleAccessMulti(
  vehicleId: string,
  _villaIds: string[] = [],
): Promise<AccessDecision & { matched_villa_id?: string | null }> {
  const decision = await validateVehicleAccess(vehicleId);
  return { ...decision, matched_villa_id: null };
}

// ─── Stub validators kept for import compatibility ────────────────────────────
// (reservation routes are gone but other files may import these names)

export async function validateVehicles(
  vehicleIds: string[],
): Promise<{ errors: ValidationError[]; warnings: string[] }> {
  if (!vehicleIds.length) return { errors: [], warnings: [] };

  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const vehicles = await db
    .select()
    .from(vehiclesTable);

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
