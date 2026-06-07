import { Router } from "express";
import { db } from "@workspace/db";
import { accessEventsTable, gateActionsTable, entrancesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";

const router = Router();

router.get("/events", requireAuth, async (req, res) => {
  const { status, entrance_id, event_type, page = "1", page_size = "20" } = req.query;
  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(page_size as string);
  const offset = (pageNum - 1) * pageSizeNum;

  const conditions: any[] = [];
  if (status) conditions.push(eq(accessEventsTable.status, status as any));
  if (entrance_id) conditions.push(eq(accessEventsTable.entrance_id, entrance_id as string));
  if (event_type) conditions.push(eq(accessEventsTable.event_type, event_type as any));

  const [countResult, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(accessEventsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
    db.select().from(accessEventsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${accessEventsTable.timestamp} desc`)
      .limit(pageSizeNum)
      .offset(offset),
  ]);

  res.json({
    items: rows.map((e) => ({
      id: e.id, timestamp: e.timestamp, event_type: e.event_type, status: e.status,
      confidence_score: e.confidence_score, vehicle_id: e.vehicle_id, license_plate: e.license_plate,
      entrance_id: e.entrance_id, camera_id: e.camera_id, snapshot_url: e.snapshot_url,
      notes: e.notes, vehicle: null, entrance: null,
    })),
    total: countResult[0]?.count ?? 0,
    page: pageNum,
    page_size: pageSizeNum,
  });
});

router.post("/open-gate", requireAuth, async (req: any, res) => {
  const schema = z.object({
    entrance_id: z.string(),
    duration_seconds: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const entrance = await db.select().from(entrancesTable).where(eq(entrancesTable.id, body.data.entrance_id)).limit(1);
  if (!entrance[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }

  const [action] = await db.insert(gateActionsTable).values({
    entrance_id: body.data.entrance_id,
    action_type: "open_gate",
    triggered_by: "manual",
    operator_id: req.user?.id ?? null,
    success: true,
    notes: body.data.notes ?? null,
  }).returning();

  await db.insert(accessEventsTable).values({
    event_type: "manual_open",
    status: "manual",
    entrance_id: body.data.entrance_id,
    notes: `Gate opened manually by ${req.user?.username ?? "operator"}`,
  });

  void eventBus.publish({
    event_type: "gate.opened",
    entrance_id: body.data.entrance_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action_type: "open_gate", triggered_by: "manual", operator: req.user?.username },
  });
  void eventBus.publish({
    event_type: "access.manual_override",
    entrance_id: body.data.entrance_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action: "open_gate", notes: body.data.notes ?? null },
  });

  res.json({
    id: action.id,
    entrance_id: action.entrance_id,
    action_type: action.action_type,
    triggered_by: action.triggered_by,
    operator_id: action.operator_id,
    timestamp: action.timestamp,
    success: action.success,
    notes: action.notes,
  });
});

router.post("/open-door", requireAuth, async (req: any, res) => {
  const schema = z.object({
    entrance_id: z.string(),
    duration_seconds: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const entrance = await db.select().from(entrancesTable).where(eq(entrancesTable.id, body.data.entrance_id)).limit(1);
  if (!entrance[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }

  const [action] = await db.insert(gateActionsTable).values({
    entrance_id: body.data.entrance_id,
    action_type: "open_door",
    triggered_by: "manual",
    operator_id: req.user?.id ?? null,
    success: true,
    notes: body.data.notes ?? null,
  }).returning();

  await db.insert(accessEventsTable).values({
    event_type: "manual_open",
    status: "manual",
    entrance_id: body.data.entrance_id,
    notes: `Door opened manually by ${req.user?.username ?? "operator"}`,
  });

  void eventBus.publish({
    event_type: "gate.door_opened",
    entrance_id: body.data.entrance_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action_type: "open_door", triggered_by: "manual", operator: req.user?.username },
  });
  void eventBus.publish({
    event_type: "access.manual_override",
    entrance_id: body.data.entrance_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action: "open_door", notes: body.data.notes ?? null },
  });

  res.json({
    id: action.id,
    entrance_id: action.entrance_id,
    action_type: action.action_type,
    triggered_by: action.triggered_by,
    operator_id: action.operator_id,
    timestamp: action.timestamp,
    success: action.success,
    notes: action.notes,
  });
});

export { router as accessRouter };
