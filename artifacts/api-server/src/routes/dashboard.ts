import { Router } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  accessEventsTable,
  camerasTable,
  entrancesTable,
} from "@workspace/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

router.get("/stats", requireAuth, async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [vehicles, eventsToday, cameras, entrances] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(vehiclesTable).where(isNull(vehiclesTable.archived_at)),
    db.select({ count: sql<number>`count(*)::int`, status: accessEventsTable.status })
      .from(accessEventsTable)
      .where(gte(accessEventsTable.timestamp, today))
      .groupBy(accessEventsTable.status),
    db.select({ count: sql<number>`count(*)::int`, status: camerasTable.status })
      .from(camerasTable)
      .groupBy(camerasTable.status),
    db.select({ count: sql<number>`count(*)::int` })
      .from(entrancesTable)
      .where(eq(entrancesTable.active, true)),
  ]);

  const totalEvents = eventsToday.reduce((acc, r) => acc + r.count, 0);
  const deniedCount = eventsToday.find((r) => r.status === "denied")?.count ?? 0;
  const allowedCount = eventsToday.find((r) => r.status === "allowed")?.count ?? 0;
  const camerasOnline = cameras.find((r) => r.status === "online")?.count ?? 0;

  res.json({
    active_entrances: entrances[0]?.count ?? 0,
    total_vehicles: vehicles[0]?.count ?? 0,
    events_today: totalEvents,
    gates_online: entrances[0]?.count ?? 0,
    cameras_online: camerasOnline,
    denied_attempts_today: deniedCount,
    auto_opens_today: allowedCount,
  });
});

router.get("/recent-events", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const status =
    typeof req.query.status === "string" && req.query.status.length > 0
      ? req.query.status
      : null;
  const eventType =
    typeof req.query.event_type === "string" && req.query.event_type.length > 0
      ? req.query.event_type
      : null;

  const conds = [];
  if (status) conds.push(eq(accessEventsTable.status, status));
  if (eventType) conds.push(eq(accessEventsTable.event_type, eventType));

  const events = await db
    .select()
    .from(accessEventsTable)
    .where(conds.length > 0 ? and(...conds) : undefined)
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
    entrance_id: e.entrance_id,
    camera_id: e.camera_id,
    snapshot_url: e.snapshot_url,
    notes: e.notes,
    vehicle: null,
    entrance: null,
  }));

  res.json(enriched);
});

export { router as dashboardRouter };
