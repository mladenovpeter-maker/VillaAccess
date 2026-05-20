import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable, accessEventsTable } from "@workspace/db";
import { eq, or, ilike, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { status, search } = req.query;

  let rows;
  if (search) {
    const s = `%${search}%`;
    rows = await db.select().from(vehiclesTable).where(
      or(ilike(vehiclesTable.license_plate, s), ilike(vehiclesTable.make, s), ilike(vehiclesTable.model, s))
    );
  } else if (status) {
    rows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.status, status as any));
  } else {
    rows = await db.select().from(vehiclesTable).orderBy(sql`${vehiclesTable.updated_at} desc`);
  }

  res.json(rows.map((v) => ({
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
  })));
});

router.post("/", requireAuth, async (req, res) => {
  const schema = z.object({
    license_plate: z.string(),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    vehicle_type: z.enum(["sedan", "suv", "van", "truck", "motorcycle", "other"]).nullable().optional(),
    status: z.enum(["known", "unknown", "blacklisted"]).optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const [vehicle] = await db.insert(vehiclesTable).values({
    license_plate: body.data.license_plate,
    make: body.data.make ?? null,
    model: body.data.model ?? null,
    color: body.data.color ?? null,
    vehicle_type: body.data.vehicle_type ?? null,
    status: body.data.status ?? "unknown",
    notes: body.data.notes ?? null,
  }).returning();

  res.status(201).json({
    id: vehicle.id,
    license_plate: vehicle.license_plate,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    vehicle_type: vehicle.vehicle_type,
    confidence_score: vehicle.confidence_score,
    status: vehicle.status,
    snapshot_url: vehicle.snapshot_url,
    first_seen: vehicle.first_seen,
    last_seen: vehicle.last_seen,
    total_visits: vehicle.total_visits,
    notes: vehicle.notes,
  });
});

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  const v = rows[0];
  res.json({
    id: v.id, license_plate: v.license_plate, make: v.make, model: v.model,
    color: v.color, vehicle_type: v.vehicle_type, confidence_score: v.confidence_score,
    status: v.status, snapshot_url: v.snapshot_url, first_seen: v.first_seen,
    last_seen: v.last_seen, total_visits: v.total_visits, notes: v.notes,
  });
});

router.put("/:id", requireAuth, async (req, res) => {
  const schema = z.object({
    license_plate: z.string(),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    vehicle_type: z.enum(["sedan", "suv", "van", "truck", "motorcycle", "other"]).nullable().optional(),
    status: z.enum(["known", "unknown", "blacklisted"]).optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const rows = await db.update(vehiclesTable).set({
    license_plate: body.data.license_plate,
    make: body.data.make ?? null,
    model: body.data.model ?? null,
    color: body.data.color ?? null,
    vehicle_type: body.data.vehicle_type ?? null,
    status: body.data.status ?? "unknown",
    notes: body.data.notes ?? null,
    updated_at: new Date(),
  }).where(eq(vehiclesTable.id, req.params.id)).returning();

  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  const v = rows[0];
  res.json({
    id: v.id, license_plate: v.license_plate, make: v.make, model: v.model,
    color: v.color, vehicle_type: v.vehicle_type, confidence_score: v.confidence_score,
    status: v.status, snapshot_url: v.snapshot_url, first_seen: v.first_seen,
    last_seen: v.last_seen, total_visits: v.total_visits, notes: v.notes,
  });
});

router.delete("/:id", requireAuth, async (req, res) => {
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, req.params.id));
  res.status(204).send();
});

router.get("/:id/events", requireAuth, async (req, res) => {
  const events = await db.select().from(accessEventsTable)
    .where(eq(accessEventsTable.vehicle_id, req.params.id))
    .orderBy(sql`${accessEventsTable.timestamp} desc`)
    .limit(50);

  res.json({
    items: events.map((e) => ({
      id: e.id, timestamp: e.timestamp, event_type: e.event_type, status: e.status,
      confidence_score: e.confidence_score, vehicle_id: e.vehicle_id, license_plate: e.license_plate,
      villa_id: e.villa_id, camera_id: e.camera_id, snapshot_url: e.snapshot_url,
      notes: e.notes, vehicle: null, villa: null,
    })),
    total: events.length,
    page: 1,
    page_size: 50,
  });
});

export { router as vehiclesRouter };
