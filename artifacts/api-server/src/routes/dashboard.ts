import { Router } from "express";
import { db } from "@workspace/db";
import {
  villasTable,
  reservationsTable,
  vehiclesTable,
  accessEventsTable,
  camerasTable,
} from "@workspace/db";
import { eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

router.get("/stats", requireAuth, async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [villas, reservations, vehicles, eventsToday, cameras] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(villasTable),
    db.select({ count: sql<number>`count(*)::int` }).from(reservationsTable).where(eq(reservationsTable.status, "active")),
    db.select({ count: sql<number>`count(*)::int` }).from(vehiclesTable),
    db.select({ count: sql<number>`count(*)::int`, status: accessEventsTable.status })
      .from(accessEventsTable)
      .where(gte(accessEventsTable.timestamp, today))
      .groupBy(accessEventsTable.status),
    db.select({ count: sql<number>`count(*)::int`, status: camerasTable.status })
      .from(camerasTable)
      .groupBy(camerasTable.status),
  ]);

  const totalEvents = eventsToday.reduce((acc, r) => acc + r.count, 0);
  const deniedCount = eventsToday.find((r) => r.status === "denied")?.count ?? 0;
  const allowedCount = eventsToday.find((r) => r.status === "allowed")?.count ?? 0;
  const camerasOnline = cameras.find((r) => r.status === "online")?.count ?? 0;

  res.json({
    total_villas: villas[0]?.count ?? 0,
    active_reservations: reservations[0]?.count ?? 0,
    total_vehicles: vehicles[0]?.count ?? 0,
    events_today: totalEvents,
    gates_online: villas[0]?.count ?? 0,
    cameras_online: camerasOnline,
    denied_attempts_today: deniedCount,
    auto_opens_today: allowedCount,
  });
});

router.get("/recent-events", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const events = await db
    .select()
    .from(accessEventsTable)
    .orderBy(sql`${accessEventsTable.timestamp} desc`)
    .limit(limit);

  const enriched = events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    event_type: e.event_type,
    status: e.status,
    confidence_score: e.confidence_score,
    vehicle_id: e.vehicle_id,
    license_plate: e.license_plate,
    villa_id: e.villa_id,
    camera_id: e.camera_id,
    snapshot_url: e.snapshot_url,
    notes: e.notes,
    vehicle: null,
    villa: null,
  }));

  res.json(enriched);
});

export { router as dashboardRouter };
