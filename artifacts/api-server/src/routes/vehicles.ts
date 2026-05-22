import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable, vehicleSnapshotsTable, accessEventsTable } from "@workspace/db";
import { eq, or, ilike, sql, desc, and } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeVehicle(v: typeof vehiclesTable.$inferSelect) {
  return {
    id: v.id,
    license_plate: v.license_plate,
    plate_region: v.plate_region,
    make: v.make,
    model: v.model,
    color: v.color,
    vehicle_type: v.vehicle_type,
    owner_name: v.owner_name,
    ai_fingerprint: v.ai_fingerprint,
    confidence_score: v.confidence_score,
    status: v.status,
    access_type: v.access_type,
    blacklist_reason: v.blacklist_reason,
    blacklisted_at: v.blacklisted_at,
    blacklisted_by: v.blacklisted_by,
    first_seen: v.first_seen,
    last_seen: v.last_seen,
    total_visits: v.total_visits,
    snapshot_url: v.snapshot_url,
    thumbnail_url: v.thumbnail_url,
    notes: v.notes,
    created_at: v.created_at,
    updated_at: v.updated_at,
  };
}

function serializeSnapshot(s: typeof vehicleSnapshotsTable.$inferSelect) {
  return {
    id: s.id,
    vehicle_id: s.vehicle_id,
    access_event_id: s.access_event_id,
    camera_id: s.camera_id,
    snapshot_url: s.snapshot_url,
    thumbnail_url: s.thumbnail_url,
    plate_crop_url: s.plate_crop_url,
    confidence_score: s.confidence_score,
    ocr_text: s.ocr_text,
    ai_annotations: s.ai_annotations,
    is_primary: s.is_primary,
    captured_at: s.captured_at,
  };
}

const vehicleBodySchema = z.object({
  license_plate: z.string().min(1).max(20),
  plate_region: z.string().max(10).nullable().optional(),
  make: z.string().max(60).nullable().optional(),
  model: z.string().max(60).nullable().optional(),
  color: z.string().max(30).nullable().optional(),
  vehicle_type: z
    .enum(["sedan", "suv", "van", "truck", "motorcycle", "other"])
    .nullable()
    .optional(),
  owner_name: z.string().max(120).nullable().optional(),
  status: z.enum(["known", "unknown", "blacklisted"]).optional(),
  access_type: z.enum(["reservation", "permanent"]).optional(),
  notes: z.string().nullable().optional(),
  snapshot_url: z.string().url().nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
});

// ─── GET /vehicles ────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const { status, search, plate_region } = req.query;

  const conditions = [];
  if (status) conditions.push(eq(vehiclesTable.status, status as any));
  if (plate_region) conditions.push(eq(vehiclesTable.plate_region, plate_region as string));
  if (search) {
    const s = `%${search}%`;
    conditions.push(
      or(
        ilike(vehiclesTable.license_plate, s),
        ilike(vehiclesTable.make, s),
        ilike(vehiclesTable.model, s),
        ilike(vehiclesTable.owner_name, s)
      )
    );
  }

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(vehiclesTable)
          .where(conditions.length === 1 ? conditions[0] : and(...conditions))
          .orderBy(desc(vehiclesTable.updated_at))
      : await db
          .select()
          .from(vehiclesTable)
          .orderBy(desc(vehiclesTable.updated_at));

  res.json(rows.map(serializeVehicle));
});

// ─── POST /vehicles ───────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req, res) => {
  const body = vehicleBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid request", errors: body.error.issues });
    return;
  }

  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      license_plate: body.data.license_plate,
      plate_region: body.data.plate_region ?? null,
      make: body.data.make ?? null,
      model: body.data.model ?? null,
      color: body.data.color ?? null,
      vehicle_type: body.data.vehicle_type ?? null,
      owner_name: body.data.owner_name ?? null,
      status: body.data.status ?? "unknown",
      access_type: body.data.access_type ?? "reservation",
      notes: body.data.notes ?? null,
      snapshot_url: body.data.snapshot_url ?? null,
      thumbnail_url: body.data.thumbnail_url ?? null,
    })
    .returning();

  void eventBus.publish({
    event_type: "vehicle.created",
    vehicle_id: vehicle.id,
    operator_id: (req as any).user?.id,
    source: "dashboard",
    payload: {
      license_plate: vehicle.license_plate,
      status: vehicle.status,
      make: vehicle.make ?? undefined,
      model: vehicle.model ?? undefined,
    },
  });

  res.status(201).json(serializeVehicle(vehicle));
});

// ─── GET /vehicles/:id ────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, req.params.id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }
  res.json(serializeVehicle(rows[0]));
});

// ─── PUT /vehicles/:id ────────────────────────────────────────────────────────

router.put("/:id", requireAuth, async (req, res) => {
  const body = vehicleBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid request", errors: body.error.issues });
    return;
  }

  // If status is being set to blacklisted, clear blacklist fields if un-blacklisting
  const statusIsBlacklisted = body.data.status === "blacklisted";

  const rows = await db
    .update(vehiclesTable)
    .set({
      license_plate: body.data.license_plate,
      plate_region: body.data.plate_region ?? null,
      make: body.data.make ?? null,
      model: body.data.model ?? null,
      color: body.data.color ?? null,
      vehicle_type: body.data.vehicle_type ?? null,
      owner_name: body.data.owner_name ?? null,
      status: body.data.status ?? "unknown",
      access_type: body.data.access_type ?? "reservation",
      notes: body.data.notes ?? null,
      snapshot_url: body.data.snapshot_url ?? null,
      thumbnail_url: body.data.thumbnail_url ?? null,
      // Clear blacklist metadata if status is no longer blacklisted
      ...(!statusIsBlacklisted
        ? { blacklist_reason: null, blacklisted_at: null, blacklisted_by: null }
        : {}),
      updated_at: new Date(),
    })
    .where(eq(vehiclesTable.id, req.params.id))
    .returning();

  if (!rows[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }

  void eventBus.publish({
    event_type: "vehicle.updated",
    vehicle_id: rows[0].id,
    operator_id: (req as any).user?.id,
    source: "dashboard",
    payload: {
      license_plate: rows[0].license_plate,
      status: rows[0].status,
    },
  });

  res.json(serializeVehicle(rows[0]));
});

// ─── DELETE /vehicles/:id ─────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, req.params.id));
  res.status(204).send();
});

// ─── PATCH /vehicles/:id/blacklist ────────────────────────────────────────────

router.patch("/:id/blacklist", requireAuth, async (req: any, res) => {
  const schema = z.object({
    reason: z.string().min(1).max(500),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "reason is required" });
    return;
  }

  const rows = await db
    .update(vehiclesTable)
    .set({
      status: "blacklisted",
      blacklist_reason: body.data.reason,
      blacklisted_at: new Date(),
      blacklisted_by: req.user?.id ?? null,
      updated_at: new Date(),
    })
    .where(eq(vehiclesTable.id, req.params.id))
    .returning();

  if (!rows[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }

  void eventBus.publish({
    event_type: "vehicle.blacklisted",
    severity: "warning",
    vehicle_id: rows[0].id,
    operator_id: (req as any).user?.id,
    source: "dashboard",
    payload: {
      license_plate: rows[0].license_plate,
      reason: body.data.reason,
    },
  });

  res.json(serializeVehicle(rows[0]));
});

// ─── PATCH /vehicles/:id/unblacklist ─────────────────────────────────────────

router.patch("/:id/unblacklist", requireAuth, async (req, res) => {
  const rows = await db
    .update(vehiclesTable)
    .set({
      status: "known",
      blacklist_reason: null,
      blacklisted_at: null,
      blacklisted_by: null,
      updated_at: new Date(),
    })
    .where(eq(vehiclesTable.id, req.params.id))
    .returning();

  if (!rows[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }

  void eventBus.publish({
    event_type: "vehicle.unblacklisted",
    vehicle_id: rows[0].id,
    operator_id: (req as any).user?.id,
    source: "dashboard",
    payload: { license_plate: rows[0].license_plate },
  });

  res.json(serializeVehicle(rows[0]));
});

// ─── PATCH /vehicles/:id/fingerprint ─────────────────────────────────────────
// Called by the AI worker when it processes a new recognition event

router.patch("/:id/fingerprint", requireAuth, async (req, res) => {
  const schema = z.object({
    embedding: z.array(z.number()).min(32).max(2048),
    model_version: z.string(),
    extracted_at: z.string(),
    plate_confidence: z.number().min(0).max(1),
    vehicle_confidence: z.number().min(0).max(1),
    ocr_candidates: z.array(z.string()).optional(),
    color_histogram: z.array(z.number()).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid fingerprint payload", errors: body.error.issues });
    return;
  }

  const rows = await db
    .update(vehiclesTable)
    .set({
      ai_fingerprint: {
        embedding: body.data.embedding,
        model_version: body.data.model_version,
        extracted_at: body.data.extracted_at,
        plate_confidence: body.data.plate_confidence,
        vehicle_confidence: body.data.vehicle_confidence,
        ocr_candidates: body.data.ocr_candidates ?? [],
        color_histogram: body.data.color_histogram,
      },
      confidence_score: body.data.plate_confidence,
      updated_at: new Date(),
    })
    .where(eq(vehiclesTable.id, req.params.id))
    .returning();

  if (!rows[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }
  void eventBus.publish({
    event_type: "ai.fingerprint_updated",
    vehicle_id: rows[0].id,
    source: "ai_worker",
    payload: {
      license_plate: rows[0].license_plate,
      model_version: body.data.model_version,
      plate_confidence: body.data.plate_confidence,
      vehicle_confidence: body.data.vehicle_confidence,
    },
  });

  res.json({ id: rows[0].id, fingerprint_updated: true, model_version: body.data.model_version });
});

// ─── GET /vehicles/:id/snapshots ─────────────────────────────────────────────

router.get("/:id/snapshots", requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const page_size = Math.min(100, parseInt(req.query.page_size as string) || 20);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(vehicleSnapshotsTable)
      .where(eq(vehicleSnapshotsTable.vehicle_id, req.params.id))
      .orderBy(desc(vehicleSnapshotsTable.captured_at))
      .limit(page_size)
      .offset((page - 1) * page_size),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(vehicleSnapshotsTable)
      .where(eq(vehicleSnapshotsTable.vehicle_id, req.params.id)),
  ]);

  res.json({
    items: rows.map(serializeSnapshot),
    total: countRows[0]?.count ?? 0,
    page,
    page_size,
  });
});

// ─── POST /vehicles/:id/snapshots ────────────────────────────────────────────

router.post("/:id/snapshots", requireAuth, async (req, res) => {
  const schema = z.object({
    snapshot_url: z.string().url(),
    thumbnail_url: z.string().url().nullable().optional(),
    plate_crop_url: z.string().url().nullable().optional(),
    camera_id: z.string().nullable().optional(),
    access_event_id: z.string().nullable().optional(),
    confidence_score: z.number().min(0).max(1).nullable().optional(),
    ocr_text: z.string().nullable().optional(),
    ai_annotations: z.record(z.any()).optional(),
    is_primary: z.boolean().optional(),
    captured_at: z.string().datetime().optional(),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid snapshot payload", errors: body.error.issues });
    return;
  }

  // Verify vehicle exists
  const vehicles = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, req.params.id))
    .limit(1);

  if (!vehicles[0]) {
    res.status(404).json({ detail: "Vehicle not found" });
    return;
  }

  // If marking as primary, clear existing primary flag
  if (body.data.is_primary) {
    await db
      .update(vehicleSnapshotsTable)
      .set({ is_primary: false })
      .where(
        and(
          eq(vehicleSnapshotsTable.vehicle_id, req.params.id),
          eq(vehicleSnapshotsTable.is_primary, true)
        )
      );
  }

  const [snapshot] = await db
    .insert(vehicleSnapshotsTable)
    .values({
      vehicle_id: req.params.id,
      snapshot_url: body.data.snapshot_url,
      thumbnail_url: body.data.thumbnail_url ?? null,
      plate_crop_url: body.data.plate_crop_url ?? null,
      camera_id: body.data.camera_id ?? null,
      access_event_id: body.data.access_event_id ?? null,
      confidence_score: body.data.confidence_score ?? null,
      ocr_text: body.data.ocr_text ?? null,
      ai_annotations: body.data.ai_annotations ?? null,
      is_primary: body.data.is_primary ?? false,
      captured_at: body.data.captured_at ? new Date(body.data.captured_at) : new Date(),
    })
    .returning();

  // Promote snapshot_url on the vehicle if this is the new primary
  if (body.data.is_primary) {
    await db
      .update(vehiclesTable)
      .set({
        snapshot_url: body.data.snapshot_url,
        thumbnail_url: body.data.thumbnail_url ?? null,
        updated_at: new Date(),
      })
      .where(eq(vehiclesTable.id, req.params.id));
  }

  res.status(201).json(serializeSnapshot(snapshot));
});

// ─── GET /vehicles/:id/events ─────────────────────────────────────────────────

router.get("/:id/events", requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const page_size = Math.min(100, parseInt(req.query.page_size as string) || 20);

  const [events, countRows] = await Promise.all([
    db
      .select()
      .from(accessEventsTable)
      .where(eq(accessEventsTable.vehicle_id, req.params.id))
      .orderBy(desc(accessEventsTable.timestamp))
      .limit(page_size)
      .offset((page - 1) * page_size),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(accessEventsTable)
      .where(eq(accessEventsTable.vehicle_id, req.params.id)),
  ]);

  res.json({
    items: events.map((e) => ({
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
    })),
    total: countRows[0]?.count ?? 0,
    page,
    page_size,
  });
});

export { router as vehiclesRouter };
