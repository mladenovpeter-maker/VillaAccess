import { Router } from "express";
import { db } from "@workspace/db";
import { reservationsTable, reservationVehiclesTable, villasTable, vehiclesTable, intercomsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";
import {
  validateReservationCreate,
  validateReservationUpdate,
  computeAccessWindow,
  syncReservationStatus,
} from "../lib/validation/reservation-validator";
import { syncPinToIntercoms, revokePinFromIntercoms } from "../services/pin-sync";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

type DbReservation = typeof reservationsTable.$inferSelect;

async function enrichReservation(r: DbReservation, includeWindow = false) {
  const [vehicleLinks, villaRows, intercoms] = await Promise.all([
    db.select().from(reservationVehiclesTable).where(eq(reservationVehiclesTable.reservation_id, r.id)),
    db.select().from(villasTable).where(eq(villasTable.id, r.villa_id)).limit(1),
    db.select({
      id: intercomsTable.id,
      name: intercomsTable.name,
      ip_address: intercomsTable.ip_address,
      protocol: intercomsTable.protocol,
      pin_sync_enabled: intercomsTable.pin_sync_enabled,
      last_sync_status: intercomsTable.last_sync_status,
      last_sync_at: intercomsTable.last_sync_at,
      status: intercomsTable.status,
      entrance_id: intercomsTable.entrance_id,
    }).from(intercomsTable).where(eq(intercomsTable.pin_sync_enabled, true)),
  ]);

  const vehicleIds = vehicleLinks.map((v) => v.vehicle_id);
  const vehicles = vehicleIds.length > 0
    ? await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds))
    : [];

  const villa = villaRows[0] ?? null;

  return {
    id:              r.id,
    guest_name:      r.guest_name,
    guest_phone:     r.guest_phone,
    guest_email:     r.guest_email,
    villa_id:        r.villa_id,
    check_in:        r.check_in,
    check_out:       r.check_out,
    status:          r.status,
    notes:           r.notes,
    pin_code:        r.pin_code,
    pin_valid_from:  r.pin_valid_from  ?? null,
    pin_valid_to:    r.pin_valid_to    ?? null,
    pin_sync_status: r.pin_sync_status,
    pin_last_synced_at: r.pin_last_synced_at ?? null,
    actual_check_in:  r.actual_check_in  ?? null,
    actual_check_out: r.actual_check_out ?? null,
    cancelled_at:    r.cancelled_at  ?? null,
    cancelled_by:    r.cancelled_by  ?? null,
    created_at:      r.created_at,
    updated_at:      r.updated_at,
    vehicle_ids: vehicleIds,
    villa: villa,
    vehicles: vehicles.map((v) => ({
      id: v.id, license_plate: v.license_plate, make: v.make, model: v.model,
      color: v.color, vehicle_type: v.vehicle_type, confidence_score: v.confidence_score,
      status: v.status, snapshot_url: v.snapshot_url, first_seen: v.first_seen,
      last_seen: v.last_seen, total_visits: v.total_visits, notes: v.notes,
    })),
    assigned_intercoms: intercoms,
    ...(includeWindow ? { access_window: computeAccessWindow(r) } : {}),
  };
}

// ── Helpers: resolve license plates → vehicle IDs ────────────────────────────

async function resolveLicensePlates(
  plates: Array<{ plate: string; make?: string | null; model?: string | null; color?: string | null }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of plates) {
    const normalized = entry.plate.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalized) continue;

    const existing = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.license_plate, normalized))
      .limit(1);

    if (existing[0]) {
      ids.push(existing[0].id);
    } else {
      const [created] = await db
        .insert(vehiclesTable)
        .values({
          license_plate: normalized,
          make:   entry.make?.trim()  || null,
          model:  entry.model?.trim() || null,
          color:  entry.color?.trim() || null,
          status: "known",
        })
        .returning({ id: vehiclesTable.id });
      ids.push(created.id);
    }
  }
  return ids;
}

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const { status, villa_id } = req.query;

  const conditions: any[] = [];
  if (status)   conditions.push(eq(reservationsTable.status,   status as any));
  if (villa_id) conditions.push(eq(reservationsTable.villa_id, villa_id as string));

  const rows = conditions.length > 0
    ? await db.select().from(reservationsTable).where(and(...conditions)).orderBy(desc(reservationsTable.check_in))
    : await db.select().from(reservationsTable).orderBy(desc(reservationsTable.check_in));

  const synced = await Promise.all(rows.map(syncReservationStatus));
  const result = await Promise.all(synced.map((r) => enrichReservation(r, false)));
  res.json(result);
});

// ── POST / ───────────────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req: any, res) => {
  const plateEntrySchema = z.object({
    plate: z.string().min(1).max(20),
    make:  z.string().max(60).nullable().optional(),
    model: z.string().max(60).nullable().optional(),
    color: z.string().max(30).nullable().optional(),
  });
  const schema = z.object({
    guest_name:     z.string().min(1),
    guest_phone:    z.string().nullable().optional(),
    guest_email:    z.string().nullable().optional(),
    villa_id:       z.string(),
    check_in:       z.string(),
    check_out:      z.string(),
    notes:          z.string().nullable().optional(),
    pin_code:       z.string().max(20).nullable().optional(),
    license_plates: z.array(plateEntrySchema).optional(),
    vehicle_ids:    z.array(z.string()).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", issues: body.error.issues }); return; }

  const checkIn  = new Date(body.data.check_in);
  const checkOut = new Date(body.data.check_out);

  // Resolve inline plate entries → vehicle IDs (auto-create if new)
  const plateIds   = body.data.license_plates?.length
    ? await resolveLicensePlates(body.data.license_plates)
    : [];
  const vehicleIds = [...new Set([...plateIds, ...(body.data.vehicle_ids ?? [])])];

  const validation = await validateReservationCreate({
    villa_id:    body.data.villa_id,
    check_in:    checkIn,
    check_out:   checkOut,
    vehicle_ids: vehicleIds,
  });

  if (!validation.valid) {
    res.status(422).json({ detail: "Validation failed", errors: validation.errors, warnings: validation.warnings });
    return;
  }

  const pinCode = (body.data.pin_code && body.data.pin_code.trim())
    ? body.data.pin_code.trim()
    : Math.floor(1000 + Math.random() * 9000).toString();

  const ACCESS_GRACE_MS = 60 * 60 * 1000;
  const [reservation] = await db.insert(reservationsTable).values({
    guest_name:     body.data.guest_name,
    guest_phone:    body.data.guest_phone  ?? null,
    guest_email:    body.data.guest_email  ?? null,
    villa_id:       body.data.villa_id,
    check_in:       checkIn,
    check_out:      checkOut,
    pin_code:       pinCode,
    pin_valid_from: new Date(checkIn.getTime()  - ACCESS_GRACE_MS),
    pin_valid_to:   new Date(checkOut.getTime() + ACCESS_GRACE_MS),
    pin_sync_status: "pending",
    status:         "upcoming",
  }).returning();

  if (vehicleIds.length) {
    await db.insert(reservationVehiclesTable).values(
      vehicleIds.map((vid) => ({ reservation_id: reservation.id, vehicle_id: vid })),
    );
  }

  const enriched = await enrichReservation(reservation, true);

  void eventBus.publish({
    event_type:     "reservation.created",
    reservation_id: reservation.id,
    villa_id:       body.data.villa_id,
    operator_id:    req.user?.id,
    source:         "dashboard",
    payload: {
      guest_name: body.data.guest_name,
      check_in:   checkIn.toISOString(),
      check_out:  checkOut.toISOString(),
      villa_name: (enriched.villa as any)?.name,
      ...(validation.warnings.length ? { warnings: validation.warnings } : {}),
    },
  });

  // Async PIN sync — does not block the response
  void syncPinToIntercoms(reservation, req.user?.id);

  res.status(201).json(enriched);
});

// ── GET /:id ─────────────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  const synced = await syncReservationStatus(rows[0]);
  res.json(await enrichReservation(synced, true));
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────

router.put("/:id", requireAuth, async (req: any, res) => {
  const plateEntrySchema = z.object({
    plate: z.string().min(1).max(20),
    make:  z.string().max(60).nullable().optional(),
    model: z.string().max(60).nullable().optional(),
    color: z.string().max(30).nullable().optional(),
  });
  const schema = z.object({
    guest_name:     z.string().min(1),
    guest_phone:    z.string().nullable().optional(),
    guest_email:    z.string().nullable().optional(),
    villa_id:       z.string(),
    check_in:       z.string(),
    check_out:      z.string(),
    notes:          z.string().nullable().optional(),
    pin_code:       z.string().max(20).nullable().optional(),
    license_plates: z.array(plateEntrySchema).optional(),
    vehicle_ids:    z.array(z.string()).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", issues: body.error.issues }); return; }

  const checkIn  = new Date(body.data.check_in);
  const checkOut = new Date(body.data.check_out);

  // Resolve inline plate entries → vehicle IDs (auto-create if new)
  const plateIds   = body.data.license_plates?.length
    ? await resolveLicensePlates(body.data.license_plates)
    : [];
  const vehicleIds = body.data.license_plates?.length
    ? [...new Set([...plateIds, ...(body.data.vehicle_ids ?? [])])]
    : (body.data.vehicle_ids ?? []);

  const validation = await validateReservationUpdate(
    { villa_id: body.data.villa_id, check_in: checkIn, check_out: checkOut, vehicle_ids: vehicleIds },
    req.params.id,
  );

  if (!validation.valid) {
    res.status(422).json({ detail: "Validation failed", errors: validation.errors, warnings: validation.warnings });
    return;
  }

  // Fetch current to detect date changes
  const current = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  const datesChanged = current[0] &&
    (current[0].check_in.getTime() !== checkIn.getTime() || current[0].check_out.getTime() !== checkOut.getTime());

  const ACCESS_GRACE_MS = 60 * 60 * 1000;
  const rows = await db.update(reservationsTable).set({
    guest_name:     body.data.guest_name,
    guest_phone:    body.data.guest_phone ?? null,
    guest_email:    body.data.guest_email ?? null,
    villa_id:       body.data.villa_id,
    check_in:       checkIn,
    check_out:      checkOut,
    notes:          body.data.notes ?? null,
    pin_valid_from: new Date(checkIn.getTime()  - ACCESS_GRACE_MS),
    pin_valid_to:   new Date(checkOut.getTime() + ACCESS_GRACE_MS),
    ...(datesChanged ? { pin_sync_status: "pending" } : {}),
    updated_at:     new Date(),
  }).where(eq(reservationsTable.id, req.params.id)).returning();

  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  // Always overwrite vehicles when license_plates or vehicle_ids are provided
  if (body.data.license_plates !== undefined || body.data.vehicle_ids !== undefined) {
    await db.delete(reservationVehiclesTable).where(eq(reservationVehiclesTable.reservation_id, req.params.id));
    if (vehicleIds.length > 0) {
      await db.insert(reservationVehiclesTable).values(
        vehicleIds.map((vid) => ({ reservation_id: req.params.id, vehicle_id: vid })),
      );
    }
  }

  void eventBus.publish({
    event_type:     "reservation.updated",
    reservation_id: req.params.id,
    villa_id:       body.data.villa_id,
    operator_id:    req.user?.id,
    source:         "dashboard",
    payload: { guest_name: body.data.guest_name, check_in: checkIn.toISOString(), check_out: checkOut.toISOString(), dates_changed: datesChanged },
  });

  // Re-sync PIN if dates changed
  if (datesChanged) {
    void syncPinToIntercoms(rows[0], req.user?.id);
  }

  res.json(await enrichReservation(rows[0], true));
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (rows[0]) {
    // Await revoke so any device-side failure is surfaced in logs BEFORE the
    // row is gone. We still proceed to delete the reservation even if revoke
    // fails — the expiry sweep will retry the orphaned device-side record.
    try {
      const result = await revokePinFromIntercoms(rows[0], req.user?.id);
      if (result.failed > 0) {
        console.warn(`[reservations.delete] revoke had ${result.failed} failure(s) for reservation ${rows[0].id}`);
      }
    } catch (err) {
      console.error(`[reservations.delete] revoke threw for reservation ${rows[0].id}:`, err);
    }
  }
  await db.delete(reservationsTable).where(eq(reservationsTable.id, req.params.id));
  res.status(204).send();
});

// ── POST /:id/check-in ────────────────────────────────────────────────────────

router.post("/:id/check-in", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const r = rows[0];
  if (!["upcoming", "active"].includes(r.status)) {
    res.status(400).json({ detail: `Cannot check in: reservation is ${r.status}` });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(reservationsTable)
    .set({ status: "active", actual_check_in: now, updated_at: now })
    .where(eq(reservationsTable.id, req.params.id))
    .returning();

  void eventBus.publish({
    event_type: "reservation.checked_in", severity: "info",
    reservation_id: updated.id, villa_id: updated.villa_id, operator_id: req.user?.id, source: "dashboard",
    payload: { guest_name: updated.guest_name, actual_check_in: now.toISOString() },
  });

  res.json(await enrichReservation(updated, true));
});

// ── POST /:id/check-out ───────────────────────────────────────────────────────

router.post("/:id/check-out", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const r = rows[0];
  if (!["active", "upcoming"].includes(r.status)) {
    res.status(400).json({ detail: `Cannot check out: reservation is ${r.status}` });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(reservationsTable)
    .set({ status: "completed", actual_check_out: now, updated_at: now })
    .where(eq(reservationsTable.id, req.params.id))
    .returning();

  void eventBus.publish({
    event_type: "reservation.checked_out", severity: "info",
    reservation_id: updated.id, villa_id: updated.villa_id, operator_id: req.user?.id, source: "dashboard",
    payload: { guest_name: updated.guest_name, actual_check_out: now.toISOString() },
  });

  // Revoke PIN on checkout
  void revokePinFromIntercoms(updated, req.user?.id);

  res.json(await enrichReservation(updated, true));
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────

router.post("/:id/cancel", requireAuth, async (req: any, res) => {
  const schema = z.object({ reason: z.string().optional() });
  const body = schema.safeParse(req.body);

  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const r = rows[0];
  if (r.status === "completed") {
    res.status(400).json({ detail: "Cannot cancel a completed reservation" });
    return;
  }
  if (r.status === "cancelled") {
    res.status(400).json({ detail: "Reservation is already cancelled" });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(reservationsTable)
    .set({ status: "cancelled", cancelled_at: now, cancelled_by: req.user?.id ?? null, updated_at: now })
    .where(eq(reservationsTable.id, req.params.id))
    .returning();

  void eventBus.publish({
    event_type: "reservation.cancelled", severity: "warning",
    reservation_id: updated.id, villa_id: updated.villa_id, operator_id: req.user?.id, source: "dashboard",
    payload: { guest_name: updated.guest_name, reason: body.success ? (body.data.reason ?? null) : null },
  });

  // Revoke PIN on cancellation — await so the device-side state matches the
  // DB state before we respond. Failure is logged but does not block the
  // cancellation (sweep will retry the orphaned device record).
  try {
    const result = await revokePinFromIntercoms(updated, req.user?.id);
    if (result.failed > 0) {
      console.warn(`[reservations.cancel] revoke had ${result.failed} failure(s) for reservation ${updated.id}`);
    }
  } catch (err) {
    console.error(`[reservations.cancel] revoke threw for reservation ${updated.id}:`, err);
  }

  res.json(await enrichReservation(updated, true));
});

// ── GET /:id/access-window ────────────────────────────────────────────────────

router.get("/:id/access-window", requireAuth, async (req, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(computeAccessWindow(rows[0]));
});

// ── POST /:id/regenerate-pin ──────────────────────────────────────────────────

router.post("/:id/regenerate-pin", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const r = rows[0];
  if (["completed", "cancelled"].includes(r.status)) {
    res.status(400).json({ detail: `Cannot regenerate PIN for a ${r.status} reservation` });
    return;
  }

  // Revoke old PIN first
  void revokePinFromIntercoms(r, req.user?.id);

  const newPin = Math.floor(1000 + Math.random() * 9000).toString();
  const [updated] = await db.update(reservationsTable)
    .set({ pin_code: newPin, pin_sync_status: "pending", pin_last_synced_at: null, updated_at: new Date() })
    .where(eq(reservationsTable.id, req.params.id))
    .returning();

  void eventBus.publish({
    event_type: "reservation.pin_regenerated", severity: "info",
    reservation_id: updated.id, operator_id: req.user?.id, source: "dashboard",
    payload: { guest_name: updated.guest_name },
  });

  // Push new PIN
  const syncResult = await syncPinToIntercoms(updated, req.user?.id);

  res.json({ ...(await enrichReservation(updated, true)), sync_result: syncResult });
});

// ── POST /:id/force-sync ──────────────────────────────────────────────────────

router.post("/:id/force-sync", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const r = rows[0];
  if (!r.pin_code) {
    res.status(400).json({ detail: "No PIN code set on this reservation" });
    return;
  }

  const syncResult = await syncPinToIntercoms(r, req.user?.id);
  const updated = await db.select().from(reservationsTable).where(eq(reservationsTable.id, r.id)).limit(1);

  res.json({ ...(await enrichReservation(updated[0], true)), sync_result: syncResult });
});

// ── POST /:id/revoke-pin ──────────────────────────────────────────────────────

router.post("/:id/revoke-pin", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const syncResult = await revokePinFromIntercoms(rows[0], req.user?.id);
  const updated = await db.select().from(reservationsTable).where(eq(reservationsTable.id, rows[0].id)).limit(1);

  res.json({ ...(await enrichReservation(updated[0], true)), sync_result: syncResult });
});

export { router as reservationsRouter };
