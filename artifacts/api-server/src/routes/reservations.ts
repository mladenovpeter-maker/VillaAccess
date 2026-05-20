import { Router } from "express";
import { db } from "@workspace/db";
import { reservationsTable, reservationVehiclesTable, villasTable, vehiclesTable, camerasTable } from "@workspace/db";
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

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

type DbReservation = typeof reservationsTable.$inferSelect;

async function enrichReservation(r: DbReservation, includeWindow = false) {
  const [vehicleLinks, villaRows] = await Promise.all([
    db.select().from(reservationVehiclesTable).where(eq(reservationVehiclesTable.reservation_id, r.id)),
    db.select().from(villasTable).where(eq(villasTable.id, r.villa_id)).limit(1),
  ]);

  const vehicleIds = vehicleLinks.map((v) => v.vehicle_id);
  const vehicles = vehicleIds.length > 0
    ? await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds))
    : [];

  const villa = villaRows[0];
  let villaWithCameras = null;
  if (villa) {
    const cameras = await db.select({ id: camerasTable.id }).from(camerasTable).where(eq(camerasTable.villa_id, villa.id));
    villaWithCameras = { ...villa, camera_ids: cameras.map((c) => c.id) };
  }

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
    actual_check_in:  r.actual_check_in  ?? null,
    actual_check_out: r.actual_check_out ?? null,
    cancelled_at:    r.cancelled_at  ?? null,
    cancelled_by:    r.cancelled_by  ?? null,
    created_at:      r.created_at,
    updated_at:      r.updated_at,
    vehicle_ids: vehicleIds,
    villa: villaWithCameras,
    vehicles: vehicles.map((v) => ({
      id: v.id, license_plate: v.license_plate, make: v.make, model: v.model,
      color: v.color, vehicle_type: v.vehicle_type, confidence_score: v.confidence_score,
      status: v.status, snapshot_url: v.snapshot_url, first_seen: v.first_seen,
      last_seen: v.last_seen, total_visits: v.total_visits, notes: v.notes,
    })),
    ...(includeWindow ? { access_window: computeAccessWindow(r) } : {}),
  };
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
  const schema = z.object({
    guest_name:  z.string().min(1),
    guest_phone: z.string().nullable().optional(),
    guest_email: z.string().nullable().optional(),
    villa_id:    z.string(),
    check_in:    z.string(),
    check_out:   z.string(),
    vehicle_ids: z.array(z.string()).optional(),
    notes:       z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", issues: body.error.issues }); return; }

  const checkIn  = new Date(body.data.check_in);
  const checkOut = new Date(body.data.check_out);

  const validation = await validateReservationCreate({
    villa_id:    body.data.villa_id,
    check_in:    checkIn,
    check_out:   checkOut,
    vehicle_ids: body.data.vehicle_ids ?? [],
  });

  if (!validation.valid) {
    res.status(422).json({ detail: "Validation failed", errors: validation.errors, warnings: validation.warnings });
    return;
  }

  const pinCode = Math.floor(1000 + Math.random() * 9000).toString();

  const [reservation] = await db.insert(reservationsTable).values({
    guest_name:  body.data.guest_name,
    guest_phone: body.data.guest_phone  ?? null,
    guest_email: body.data.guest_email  ?? null,
    villa_id:    body.data.villa_id,
    check_in:    checkIn,
    check_out:   checkOut,
    pin_code:    pinCode,
    status:      "upcoming",
  }).returning();

  if (body.data.vehicle_ids?.length) {
    await db.insert(reservationVehiclesTable).values(
      body.data.vehicle_ids.map((vid) => ({ reservation_id: reservation.id, vehicle_id: vid })),
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
  const schema = z.object({
    guest_name:  z.string().min(1),
    guest_phone: z.string().nullable().optional(),
    guest_email: z.string().nullable().optional(),
    villa_id:    z.string(),
    check_in:    z.string(),
    check_out:   z.string(),
    vehicle_ids: z.array(z.string()).optional(),
    notes:       z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", issues: body.error.issues }); return; }

  const checkIn  = new Date(body.data.check_in);
  const checkOut = new Date(body.data.check_out);

  const validation = await validateReservationUpdate(
    { villa_id: body.data.villa_id, check_in: checkIn, check_out: checkOut, vehicle_ids: body.data.vehicle_ids ?? [] },
    req.params.id,
  );

  if (!validation.valid) {
    res.status(422).json({ detail: "Validation failed", errors: validation.errors, warnings: validation.warnings });
    return;
  }

  const rows = await db.update(reservationsTable).set({
    guest_name:  body.data.guest_name,
    guest_phone: body.data.guest_phone ?? null,
    guest_email: body.data.guest_email ?? null,
    villa_id:    body.data.villa_id,
    check_in:    checkIn,
    check_out:   checkOut,
    notes:       body.data.notes ?? null,
    updated_at:  new Date(),
  }).where(eq(reservationsTable.id, req.params.id)).returning();

  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  if (body.data.vehicle_ids !== undefined) {
    await db.delete(reservationVehiclesTable).where(eq(reservationVehiclesTable.reservation_id, req.params.id));
    if (body.data.vehicle_ids.length > 0) {
      await db.insert(reservationVehiclesTable).values(
        body.data.vehicle_ids.map((vid) => ({ reservation_id: req.params.id, vehicle_id: vid })),
      );
    }
  }

  void eventBus.publish({
    event_type:     "reservation.updated",
    reservation_id: req.params.id,
    villa_id:       body.data.villa_id,
    operator_id:    req.user?.id,
    source:         "dashboard",
    payload: { guest_name: body.data.guest_name, check_in: checkIn.toISOString(), check_out: checkOut.toISOString() },
  });

  res.json(await enrichReservation(rows[0], true));
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
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

  res.json(await enrichReservation(updated, true));
});

// ── GET /:id/access-window ────────────────────────────────────────────────────

router.get("/:id/access-window", requireAuth, async (req, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(computeAccessWindow(rows[0]));
});

export { router as reservationsRouter };
