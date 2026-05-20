import { Router } from "express";
import { db } from "@workspace/db";
import { reservationsTable, reservationVehiclesTable, villasTable, vehiclesTable, camerasTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function enrichReservation(r: typeof reservationsTable.$inferSelect) {
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
    id: r.id,
    guest_name: r.guest_name,
    guest_phone: r.guest_phone,
    guest_email: r.guest_email,
    villa_id: r.villa_id,
    check_in: r.check_in,
    check_out: r.check_out,
    status: r.status,
    vehicle_ids: vehicleIds,
    notes: r.notes,
    pin_code: r.pin_code,
    villa: villaWithCameras,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      license_plate: v.license_plate,
      make: v.make,
      model: v.model,
      color: v.color,
      vehicle_type: v.vehicle_type,
      confidence_score: v.confidence_score,
      status: v.status,
      snapshot_url: v.snapshot_url,
      first_seen: v.first_seen,
      last_seen: v.last_seen,
      total_visits: v.total_visits,
      notes: v.notes,
    })),
  };
}

router.get("/", requireAuth, async (req, res) => {
  const { status, villa_id } = req.query;

  let query = db.select().from(reservationsTable);
  const conditions: any[] = [];
  if (status) conditions.push(eq(reservationsTable.status, status as any));
  if (villa_id) conditions.push(eq(reservationsTable.villa_id, villa_id as string));

  const rows = conditions.length > 0
    ? await db.select().from(reservationsTable).where(and(...conditions))
    : await db.select().from(reservationsTable);

  const result = await Promise.all(rows.map(enrichReservation));
  res.json(result);
});

router.post("/", requireAuth, async (req, res) => {
  const schema = z.object({
    guest_name: z.string(),
    guest_phone: z.string().nullable().optional(),
    guest_email: z.string().nullable().optional(),
    villa_id: z.string(),
    check_in: z.string(),
    check_out: z.string(),
    vehicle_ids: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const pinCode = Math.floor(1000 + Math.random() * 9000).toString();

  const [reservation] = await db.insert(reservationsTable).values({
    guest_name: body.data.guest_name,
    guest_phone: body.data.guest_phone ?? null,
    guest_email: body.data.guest_email ?? null,
    villa_id: body.data.villa_id,
    check_in: new Date(body.data.check_in),
    check_out: new Date(body.data.check_out),
    pin_code: pinCode,
    status: "upcoming",
  }).returning();

  if (body.data.vehicle_ids?.length) {
    await db.insert(reservationVehiclesTable).values(
      body.data.vehicle_ids.map((vid) => ({ reservation_id: reservation.id, vehicle_id: vid }))
    );
  }

  res.status(201).json(await enrichReservation(reservation));
});

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(reservationsTable).where(eq(reservationsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await enrichReservation(rows[0]));
});

router.put("/:id", requireAuth, async (req, res) => {
  const schema = z.object({
    guest_name: z.string(),
    guest_phone: z.string().nullable().optional(),
    guest_email: z.string().nullable().optional(),
    villa_id: z.string(),
    check_in: z.string(),
    check_out: z.string(),
    vehicle_ids: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const rows = await db.update(reservationsTable).set({
    guest_name: body.data.guest_name,
    guest_phone: body.data.guest_phone ?? null,
    guest_email: body.data.guest_email ?? null,
    villa_id: body.data.villa_id,
    check_in: new Date(body.data.check_in),
    check_out: new Date(body.data.check_out),
    notes: body.data.notes ?? null,
    updated_at: new Date(),
  }).where(eq(reservationsTable.id, req.params.id)).returning();

  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  if (body.data.vehicle_ids !== undefined) {
    await db.delete(reservationVehiclesTable).where(eq(reservationVehiclesTable.reservation_id, req.params.id));
    if (body.data.vehicle_ids.length > 0) {
      await db.insert(reservationVehiclesTable).values(
        body.data.vehicle_ids.map((vid) => ({ reservation_id: req.params.id, vehicle_id: vid }))
      );
    }
  }

  res.json(await enrichReservation(rows[0]));
});

router.delete("/:id", requireAuth, async (req, res) => {
  await db.delete(reservationsTable).where(eq(reservationsTable.id, req.params.id));
  res.status(204).send();
});

export { router as reservationsRouter };
