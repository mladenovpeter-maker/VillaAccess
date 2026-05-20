import { db } from "@workspace/db";
import {
  reservationsTable,
  reservationVehiclesTable,
  vehiclesTable,
  villasTable,
} from "@workspace/db";
import { eq, and, ne, lt, gt, inArray, desc } from "drizzle-orm";

const CHECKIN_GRACE_MS  = 2 * 60 * 60 * 1000;
const CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;
const MIN_STAY_MS       = 60 * 60 * 1000;
const MAX_STAY_MS       = 365 * 24 * 60 * 60 * 1000;

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

export interface AccessWindowResult {
  reservation_id: string;
  status: string;
  check_in: string;
  check_out: string;
  window_opens_at: string;
  window_closes_at: string;
  is_window_open: boolean;
  is_expired: boolean;
  minutes_until_open: number | null;
  minutes_until_close: number | null;
  access_status: "upcoming" | "open" | "expired";
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  denial_code?: string;
  reservation?: {
    id: string;
    guest_name: string;
    check_in: string;
    check_out: string;
    status: string;
    actual_check_in: string | null;
  };
  access_window?: {
    opens_at: string;
    closes_at: string;
    is_open: boolean;
    minutes_until_open: number | null;
    minutes_until_close: number | null;
  };
}

// ── Date validation ────────────────────────────────────────────────────────────

export function validateDates(
  checkIn: Date,
  checkOut: Date,
  allowPast = false,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const now = new Date();

  if (!allowPast) {
    const pastCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (checkIn < pastCutoff) {
      errors.push({
        field: "check_in",
        code: "PAST_DATE",
        message: "Check-in cannot be more than 24 hours in the past",
      });
    }
  }

  if (checkOut <= checkIn) {
    errors.push({
      field: "check_out",
      code: "BEFORE_CHECK_IN",
      message: "Check-out must be after check-in",
    });
    return errors;
  }

  const stayMs = checkOut.getTime() - checkIn.getTime();
  if (stayMs < MIN_STAY_MS) {
    errors.push({
      field: "check_out",
      code: "STAY_TOO_SHORT",
      message: "Minimum stay is 1 hour",
    });
  }
  if (stayMs > MAX_STAY_MS) {
    errors.push({
      field: "check_out",
      code: "STAY_TOO_LONG",
      message: "Maximum stay is 365 days",
    });
  }

  return errors;
}

// ── Villa existence ───────────────────────────────────────────────────────────

export async function validateVilla(villaId: string): Promise<ValidationError | null> {
  const rows = await db
    .select({ id: villasTable.id })
    .from(villasTable)
    .where(eq(villasTable.id, villaId))
    .limit(1);
  return rows[0] ? null : { field: "villa_id", code: "VILLA_NOT_FOUND", message: "Villa not found" };
}

// ── Overlap detection ─────────────────────────────────────────────────────────
// Standard interval overlap: existingStart < newEnd AND existingEnd > newStart

export async function checkVillaConflict(
  villaId: string,
  checkIn: Date,
  checkOut: Date,
  excludeId: string | null = null,
): Promise<ValidationError | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(reservationsTable.villa_id, villaId),
    ne(reservationsTable.status, "cancelled" as any),
    ne(reservationsTable.status, "completed" as any),
    lt(reservationsTable.check_in, checkOut),
    gt(reservationsTable.check_out, checkIn),
  ];
  if (excludeId) conditions.push(ne(reservationsTable.id, excludeId));

  const existing = await db
    .select({
      id: reservationsTable.id,
      guest_name: reservationsTable.guest_name,
      check_in: reservationsTable.check_in,
      check_out: reservationsTable.check_out,
    })
    .from(reservationsTable)
    .where(and(...conditions))
    .limit(1);

  if (existing[0]) {
    const ci = existing[0].check_in.toISOString().slice(0, 10);
    const co = existing[0].check_out.toISOString().slice(0, 10);
    return {
      field: "villa_id",
      code: "VILLA_CONFLICT",
      message: `Villa already booked by ${existing[0].guest_name} (${ci} → ${co})`,
    };
  }
  return null;
}

// ── Vehicle validation ────────────────────────────────────────────────────────

export async function validateVehicles(
  vehicleIds: string[],
): Promise<{ errors: ValidationError[]; warnings: string[] }> {
  if (!vehicleIds.length) return { errors: [], warnings: [] };

  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));

  const foundIds = new Set(vehicles.map((v) => v.id));
  for (const vid of vehicleIds) {
    if (!foundIds.has(vid)) {
      errors.push({ field: "vehicle_ids", code: "VEHICLE_NOT_FOUND", message: `Vehicle ${vid} not found` });
    }
  }
  for (const v of vehicles) {
    if (v.status === "blacklisted") {
      warnings.push(
        `Vehicle ${v.license_plate} is blacklisted${v.blacklist_reason ? `: ${v.blacklist_reason}` : ""}. Access will require manual override.`,
      );
    }
  }

  return { errors, warnings };
}

// ── Create validation ─────────────────────────────────────────────────────────

export async function validateReservationCreate(data: {
  villa_id: string;
  check_in: Date;
  check_out: Date;
  vehicle_ids: string[];
}): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  errors.push(...validateDates(data.check_in, data.check_out));

  const villaErr = await validateVilla(data.villa_id);
  if (villaErr) {
    errors.push(villaErr);
  } else if (data.check_out > data.check_in) {
    const conflict = await checkVillaConflict(data.villa_id, data.check_in, data.check_out);
    if (conflict) errors.push(conflict);
  }

  if (data.vehicle_ids.length > 0) {
    const { errors: vErrs, warnings: vWarns } = await validateVehicles(data.vehicle_ids);
    errors.push(...vErrs);
    warnings.push(...vWarns);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Update validation ─────────────────────────────────────────────────────────

export async function validateReservationUpdate(
  data: { villa_id: string; check_in: Date; check_out: Date; vehicle_ids: string[] },
  reservationId: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  errors.push(...validateDates(data.check_in, data.check_out, true));

  const villaErr = await validateVilla(data.villa_id);
  if (villaErr) {
    errors.push(villaErr);
  } else if (data.check_out > data.check_in) {
    const conflict = await checkVillaConflict(data.villa_id, data.check_in, data.check_out, reservationId);
    if (conflict) errors.push(conflict);
  }

  if (data.vehicle_ids.length > 0) {
    const { errors: vErrs, warnings: vWarns } = await validateVehicles(data.vehicle_ids);
    errors.push(...vErrs);
    warnings.push(...vWarns);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Access window computation ─────────────────────────────────────────────────

export function computeAccessWindow(
  reservation: { id: string; status: string; check_in: Date; check_out: Date },
  now = new Date(),
): AccessWindowResult {
  const windowOpens  = new Date(reservation.check_in.getTime()  - CHECKIN_GRACE_MS);
  const windowCloses = new Date(reservation.check_out.getTime() + CHECKOUT_GRACE_MS);
  const isOpen    = now >= windowOpens && now <= windowCloses;
  const isExpired = now > windowCloses;

  const msUntilOpen  = now < windowOpens  ? windowOpens.getTime()  - now.getTime() : null;
  const msUntilClose = now < windowCloses ? windowCloses.getTime() - now.getTime() : null;

  return {
    reservation_id:   reservation.id,
    status:           reservation.status,
    check_in:         reservation.check_in.toISOString(),
    check_out:        reservation.check_out.toISOString(),
    window_opens_at:  windowOpens.toISOString(),
    window_closes_at: windowCloses.toISOString(),
    is_window_open:   isOpen,
    is_expired:       isExpired,
    minutes_until_open:  msUntilOpen  !== null ? Math.ceil(msUntilOpen  / 60_000) : null,
    minutes_until_close: msUntilClose !== null ? Math.ceil(msUntilClose / 60_000) : null,
    access_status:    isExpired ? "expired" : isOpen ? "open" : "upcoming",
  };
}

// ── Vehicle access validation ─────────────────────────────────────────────────

export async function validateVehicleAccess(
  vehicleId: string,
  villaId: string,
): Promise<AccessDecision> {
  const now = new Date();

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId))
    .limit(1);

  if (!vehicles[0]) {
    return { allowed: false, reason: "Vehicle not found in system", denial_code: "VEHICLE_NOT_FOUND" };
  }
  if (vehicles[0].status === "blacklisted") {
    return {
      allowed: false,
      reason: `Vehicle is blacklisted${vehicles[0].blacklist_reason ? `: ${vehicles[0].blacklist_reason}` : ""}`,
      denial_code: "BLACKLISTED",
    };
  }

  const links = await db
    .select({ reservation_id: reservationVehiclesTable.reservation_id })
    .from(reservationVehiclesTable)
    .where(eq(reservationVehiclesTable.vehicle_id, vehicleId));

  if (!links.length) {
    return { allowed: false, reason: "No reservation found for this vehicle", denial_code: "NO_RESERVATION" };
  }

  const reservationIds = links.map((l) => l.reservation_id);

  const reservations = await db
    .select()
    .from(reservationsTable)
    .where(and(eq(reservationsTable.villa_id, villaId), inArray(reservationsTable.id, reservationIds)))
    .orderBy(desc(reservationsTable.check_in))
    .limit(5);

  if (!reservations.length) {
    return { allowed: false, reason: "No reservation found for this vehicle at this villa", denial_code: "NO_RESERVATION" };
  }

  const best =
    reservations.find((r) => r.status === "active") ??
    reservations.find((r) => r.status === "upcoming") ??
    reservations[0];

  const serializeRes = (r: typeof best) => ({
    id: r.id,
    guest_name: r.guest_name,
    check_in:  r.check_in.toISOString(),
    check_out: r.check_out.toISOString(),
    status: r.status,
    actual_check_in: (r as any).actual_check_in?.toISOString() ?? null,
  });

  if (best.status === "cancelled") {
    return { allowed: false, reason: "Reservation has been cancelled", denial_code: "RESERVATION_CANCELLED", reservation: serializeRes(best) };
  }
  if (best.status === "completed") {
    return { allowed: false, reason: "Reservation is already completed (guest has checked out)", denial_code: "RESERVATION_EXPIRED", reservation: serializeRes(best) };
  }

  const windowOpens  = new Date(best.check_in.getTime()  - CHECKIN_GRACE_MS);
  const windowCloses = new Date(best.check_out.getTime() + CHECKOUT_GRACE_MS);

  const accessWindowData = {
    opens_at:  windowOpens.toISOString(),
    closes_at: windowCloses.toISOString(),
    is_open:   now >= windowOpens && now <= windowCloses,
    minutes_until_open:  now < windowOpens  ? Math.ceil((windowOpens.getTime()  - now.getTime()) / 60_000) : null,
    minutes_until_close: now < windowCloses ? Math.ceil((windowCloses.getTime() - now.getTime()) / 60_000) : null,
  };

  if (now > windowCloses) {
    return {
      allowed: false,
      reason: `Check-out window has expired (closed ${windowCloses.toLocaleString()})`,
      denial_code: "RESERVATION_EXPIRED",
      reservation: serializeRes(best),
      access_window: accessWindowData,
    };
  }

  if (now < windowOpens) {
    const h = Math.ceil((windowOpens.getTime() - now.getTime()) / 3_600_000);
    return {
      allowed: false,
      reason: `Access window not yet open — opens in ${h}h (${windowOpens.toLocaleString()})`,
      denial_code: "OUTSIDE_WINDOW",
      reservation: serializeRes(best),
      access_window: accessWindowData,
    };
  }

  return { allowed: true, reason: "Access granted", reservation: serializeRes(best), access_window: accessWindowData };
}

// ── Status sync (lazy) ────────────────────────────────────────────────────────

export async function syncReservationStatus(
  reservation: typeof reservationsTable.$inferSelect,
): Promise<typeof reservationsTable.$inferSelect> {
  const now = new Date();
  let newStatus: "active" | "completed" | null = null;

  if (reservation.status === "upcoming" && now >= reservation.check_in) newStatus = "active";
  else if (reservation.status === "active"   && now >  reservation.check_out) newStatus = "completed";

  if (!newStatus) return reservation;

  const [updated] = await db
    .update(reservationsTable)
    .set({ status: newStatus, updated_at: now })
    .where(eq(reservationsTable.id, reservation.id))
    .returning();

  return updated ?? reservation;
}
