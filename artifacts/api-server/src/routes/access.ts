import { Router } from "express";
import { db } from "@workspace/db";
import { accessEventsTable, gateActionsTable, tempCredentialsTable, villasTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";
import { validateVehicleAccess } from "../lib/validation/reservation-validator";

const router = Router();

router.get("/events", requireAuth, async (req, res) => {
  const { status, villa_id, event_type, page = "1", page_size = "20" } = req.query;
  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(page_size as string);
  const offset = (pageNum - 1) * pageSizeNum;

  const conditions: any[] = [];
  if (status) conditions.push(eq(accessEventsTable.status, status as any));
  if (villa_id) conditions.push(eq(accessEventsTable.villa_id, villa_id as string));
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
      villa_id: e.villa_id, camera_id: e.camera_id, snapshot_url: e.snapshot_url,
      notes: e.notes, vehicle: null, villa: null,
    })),
    total: countResult[0]?.count ?? 0,
    page: pageNum,
    page_size: pageSizeNum,
  });
});

router.post("/open-gate", requireAuth, async (req: any, res) => {
  const schema = z.object({
    villa_id: z.string(),
    duration_seconds: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const villa = await db.select().from(villasTable).where(eq(villasTable.id, body.data.villa_id)).limit(1);
  if (!villa[0]) { res.status(404).json({ detail: "Villa not found" }); return; }

  const [action] = await db.insert(gateActionsTable).values({
    villa_id: body.data.villa_id,
    action_type: "open_gate",
    triggered_by: "manual",
    operator_id: req.user?.id ?? null,
    success: true,
    notes: body.data.notes ?? null,
  }).returning();

  await db.insert(accessEventsTable).values({
    event_type: "manual_open",
    status: "manual",
    villa_id: body.data.villa_id,
    notes: `Gate opened manually by ${req.user?.username ?? "operator"}`,
  });

  void eventBus.publish({
    event_type: "gate.opened",
    villa_id: body.data.villa_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action_type: "open_gate", triggered_by: "manual", operator: req.user?.username },
  });
  void eventBus.publish({
    event_type: "access.manual_override",
    villa_id: body.data.villa_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action: "open_gate", notes: body.data.notes ?? null },
  });

  res.json({
    id: action.id,
    villa_id: action.villa_id,
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
    villa_id: z.string(),
    duration_seconds: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const villa = await db.select().from(villasTable).where(eq(villasTable.id, body.data.villa_id)).limit(1);
  if (!villa[0]) { res.status(404).json({ detail: "Villa not found" }); return; }

  const [action] = await db.insert(gateActionsTable).values({
    villa_id: body.data.villa_id,
    action_type: "open_door",
    triggered_by: "manual",
    operator_id: req.user?.id ?? null,
    success: true,
    notes: body.data.notes ?? null,
  }).returning();

  await db.insert(accessEventsTable).values({
    event_type: "manual_open",
    status: "manual",
    villa_id: body.data.villa_id,
    notes: `Door opened manually by ${req.user?.username ?? "operator"}`,
  });

  void eventBus.publish({
    event_type: "gate.door_opened",
    villa_id: body.data.villa_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action_type: "open_door", triggered_by: "manual", operator: req.user?.username },
  });
  void eventBus.publish({
    event_type: "access.manual_override",
    villa_id: body.data.villa_id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: { action: "open_door", notes: body.data.notes ?? null },
  });

  res.json({
    id: action.id,
    villa_id: action.villa_id,
    action_type: action.action_type,
    triggered_by: action.triggered_by,
    operator_id: action.operator_id,
    timestamp: action.timestamp,
    success: action.success,
    notes: action.notes,
  });
});

router.get("/temp-credentials", requireAuth, async (req, res) => {
  const { reservation_id } = req.query;

  const rows = reservation_id
    ? await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.reservation_id, reservation_id as string))
    : await db.select().from(tempCredentialsTable);

  res.json(rows.map((c) => ({
    id: c.id,
    reservation_id: c.reservation_id,
    pin_code: c.pin_code,
    valid_from: c.valid_from,
    valid_until: c.valid_until,
    status: c.status,
  })));
});

router.post("/temp-credentials", requireAuth, async (req, res) => {
  const schema = z.object({
    reservation_id: z.string(),
    duration_hours: z.number().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime() + (body.data.duration_hours ?? 24) * 60 * 60 * 1000);

  const [credential] = await db.insert(tempCredentialsTable).values({
    reservation_id: body.data.reservation_id,
    pin_code: pinCode,
    valid_from: validFrom,
    valid_until: validUntil,
    status: "active",
  }).returning();

  res.status(201).json({
    id: credential.id,
    reservation_id: credential.reservation_id,
    pin_code: credential.pin_code,
    valid_from: credential.valid_from,
    valid_until: credential.valid_until,
    status: credential.status,
  });
});

export { router as accessRouter };
