import { Router } from "express";
import multer from "multer";
import path from "path";
import { promises as fs } from "fs";
import * as crypto from "crypto";
import { db } from "@workspace/db";
import { vehiclesTable, vehicleSnapshotsTable, accessEventsTable, entrancesTable } from "@workspace/db";
import { eq, and, sql, like, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";
import { uploadsUrl } from "../lib/public-url";

const router = Router();

// ─── Multer disk storage ──────────────────────────────────────────────────────

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const now = new Date();
    const dir = path.join(
      UPLOADS_ROOT,
      "snapshots",
      now.getFullYear().toString(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and WebP images are accepted"));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an absolute file path to a browser-accessible URL. */
function filePathToUrl(absolutePath: string): string {
  const rel = path.relative(UPLOADS_ROOT, absolutePath).replace(/\\/g, "/");
  return uploadsUrl(rel);
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

// ─── POST /snapshots/upload ───────────────────────────────────────────────────
//
// Multipart form fields:
//   file           required  image/jpeg | image/png | image/webp
//   vehicle_id     optional  existing vehicle id  (takes precedence)
//   license_plate  optional  used to find-or-create vehicle when no vehicle_id
//   camera_id      optional
//   confidence_score optional  0-1 float string
//   is_primary     optional  "true" | "false"
//   ocr_hint       optional  expected plate text (for future OCR verification)
//   notes          optional

router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  async (req: any, res) => {
    if (!req.file) {
      res.status(400).json({ detail: "No image file provided" });
      return;
    }

    // ── Parse metadata fields ───────────────────────────────────────────────
    const metaSchema = z.object({
      vehicle_id: z.string().optional(),
      license_plate: z.string().optional(),
      camera_id: z.string().optional(),
      confidence_score: z
        .string()
        .transform(Number)
        .pipe(z.number().min(0).max(1))
        .optional(),
      is_primary: z
        .string()
        .transform((v) => v === "true")
        .optional(),
      ocr_hint: z.string().optional(),
      notes: z.string().optional(),
    });

    const meta = metaSchema.safeParse(req.body);
    if (!meta.success) {
      await fs.unlink(req.file.path).catch(() => {});
      res.status(400).json({ detail: "Invalid metadata", errors: meta.error.issues });
      return;
    }

    const { vehicle_id, license_plate, camera_id, confidence_score, ocr_hint, notes } =
      meta.data;
    const is_primary = meta.data.is_primary ?? false;

    if (!vehicle_id && !license_plate) {
      await fs.unlink(req.file.path).catch(() => {});
      res.status(400).json({ detail: "Either vehicle_id or license_plate is required" });
      return;
    }

    // ── Resolve or create vehicle ───────────────────────────────────────────
    let vehicle: typeof vehiclesTable.$inferSelect | null = null;

    if (vehicle_id) {
      const rows = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, vehicle_id))
        .limit(1);
      vehicle = rows[0] ?? null;
    } else if (license_plate) {
      const normalized = license_plate.trim().toUpperCase();
      const rows = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.license_plate, normalized))
        .limit(1);

      if (rows[0]) {
        vehicle = rows[0];
      } else {
        // Auto-create a new unknown vehicle record
        const now = new Date();
        const [created] = await db
          .insert(vehiclesTable)
          .values({
            license_plate: normalized,
            status: "unknown",
            first_seen: now,
            last_seen: now,
            notes: notes ?? null,
          })
          .returning();
        vehicle = created;
      }
    }

    if (!vehicle) {
      await fs.unlink(req.file.path).catch(() => {});
      res.status(404).json({ detail: "Vehicle not found" });
      return;
    }

    // ── Build URLs ──────────────────────────────────────────────────────────
    const snapshotUrl = filePathToUrl(req.file.path);

    // ── Prepare OCR pipeline hook ───────────────────────────────────────────
    // Future OCR worker queries:
    //   WHERE ocr_text IS NULL AND ai_annotations->>'ocr_status' = 'pending'
    const aiAnnotations = {
      ocr_status: "pending" as const,
      ...(ocr_hint ? { ocr_hint } : {}),
      model_version: null as string | null,
      detected_plate: null as string | null,
      detected_color: null as string | null,
      detected_type: null as string | null,
      bounding_box: null as { x: number; y: number; w: number; h: number } | null,
    };

    // ── If promoting to primary, demote current primary ─────────────────────
    if (is_primary) {
      await db
        .update(vehicleSnapshotsTable)
        .set({ is_primary: false })
        .where(
          and(
            eq(vehicleSnapshotsTable.vehicle_id, vehicle.id),
            eq(vehicleSnapshotsTable.is_primary, true),
          ),
        );
    }

    // ── Insert snapshot record ──────────────────────────────────────────────
    const [snapshot] = await db
      .insert(vehicleSnapshotsTable)
      .values({
        vehicle_id: vehicle.id,
        camera_id: camera_id ?? null,
        snapshot_url: snapshotUrl,
        thumbnail_url: null, // reserved for future sharp thumbnail pass
        plate_crop_url: null, // reserved for future OCR crop pass
        confidence_score: confidence_score ?? null,
        ocr_text: null, // populated by OCR worker
        ai_annotations: aiAnnotations,
        is_primary,
        captured_at: new Date(),
      })
      .returning();

    // ── Update vehicle visit stats + snapshot_url if primary ────────────────
    const now = new Date();
    await db
      .update(vehiclesTable)
      .set({
        last_seen: now,
        first_seen: vehicle.first_seen ?? now,
        total_visits: vehicle.total_visits + 1,
        ...(is_primary ? { snapshot_url: snapshotUrl } : {}),
        updated_at: now,
      })
      .where(eq(vehiclesTable.id, vehicle.id));

    // Re-fetch updated vehicle
    const [updatedVehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicle.id))
      .limit(1);

    void eventBus.publish({
      event_type: "ai.snapshot_uploaded",
      vehicle_id: vehicle.id,
      camera_id: camera_id ?? undefined,
      source: "dashboard",
      payload: {
        snapshot_url: snapshotUrl,
        is_primary,
        ocr_hint: ocr_hint ?? null,
        license_plate: updatedVehicle.license_plate,
        file_size_bytes: req.file.size,
        ocr_status: "pending",
      },
    });

    res.status(201).json({
      snapshot: serializeSnapshot(snapshot),
      vehicle: {
        id: updatedVehicle.id,
        license_plate: updatedVehicle.license_plate,
        status: updatedVehicle.status,
        total_visits: updatedVehicle.total_visits,
        snapshot_url: updatedVehicle.snapshot_url,
      },
      file: {
        original_name: req.file.originalname,
        size_bytes: req.file.size,
        mime_type: req.file.mimetype,
        stored_path: req.file.path,
      },
      ocr: {
        status: "pending",
        hint: ocr_hint ?? null,
        message: "Snapshot queued for OCR processing",
      },
    });
  },
);

// ─── GET /snapshots/:id ───────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(vehicleSnapshotsTable)
    .where(eq(vehicleSnapshotsTable.id, req.params.id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ detail: "Snapshot not found" });
    return;
  }
  res.json(serializeSnapshot(rows[0]));
});

// ─── DELETE /snapshots/:id ────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(vehicleSnapshotsTable)
    .where(eq(vehicleSnapshotsTable.id, req.params.id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ detail: "Snapshot not found" });
    return;
  }

  const snapshot = rows[0];

  // Delete the file from disk
  if (snapshot.snapshot_url) {
    const rel = snapshot.snapshot_url.replace(/^\/api\/uploads\//, "");
    const absPath = path.join(UPLOADS_ROOT, rel);
    await fs.unlink(absPath).catch(() => {}); // swallow if already deleted
  }

  await db
    .delete(vehicleSnapshotsTable)
    .where(eq(vehicleSnapshotsTable.id, req.params.id));

  // If this was the primary, clear vehicle's snapshot_url
  if (snapshot.is_primary) {
    await db
      .update(vehiclesTable)
      .set({ snapshot_url: null, updated_at: new Date() })
      .where(eq(vehiclesTable.id, snapshot.vehicle_id));
  }

  res.status(204).send();
});

// ─── GET /snapshots — paginated gallery ──────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const {
    page = "1",
    page_size = "24",
    plate,
    event_status,
    vehicle_id,
    camera_id,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const pageSizeNum = Math.min(100, Math.max(1, parseInt(page_size)));
  const offset = (pageNum - 1) * pageSizeNum;

  // Build conditions on vehicle_snapshots
  const conditions: any[] = [];
  if (vehicle_id) conditions.push(eq(vehicleSnapshotsTable.vehicle_id, vehicle_id));
  if (camera_id) conditions.push(eq(vehicleSnapshotsTable.camera_id, camera_id));

  // Join vehicles for plate filter
  const plateFilter = plate ? plate.trim().toUpperCase() : null;

  const rows = await db
    .select({
      id: vehicleSnapshotsTable.id,
      vehicle_id: vehicleSnapshotsTable.vehicle_id,
      access_event_id: vehicleSnapshotsTable.access_event_id,
      camera_id: vehicleSnapshotsTable.camera_id,
      snapshot_url: vehicleSnapshotsTable.snapshot_url,
      thumbnail_url: vehicleSnapshotsTable.thumbnail_url,
      confidence_score: vehicleSnapshotsTable.confidence_score,
      ocr_text: vehicleSnapshotsTable.ocr_text,
      ai_annotations: vehicleSnapshotsTable.ai_annotations,
      is_primary: vehicleSnapshotsTable.is_primary,
      captured_at: vehicleSnapshotsTable.captured_at,
      vehicle_plate: vehiclesTable.license_plate,
      vehicle_status: vehiclesTable.status,
      event_status: accessEventsTable.status,
      entrance_name: entrancesTable.name,
    })
    .from(vehicleSnapshotsTable)
    .leftJoin(vehiclesTable, eq(vehicleSnapshotsTable.vehicle_id, vehiclesTable.id))
    .leftJoin(accessEventsTable, eq(vehicleSnapshotsTable.access_event_id, accessEventsTable.id))
    .leftJoin(entrancesTable, eq(accessEventsTable.entrance_id, entrancesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(vehicleSnapshotsTable.captured_at))
    .limit(pageSizeNum + 1000) // fetch extra to allow in-memory plate filter — acceptable for gallery sizes
    .offset(0);

  // In-memory filter for plate (case-insensitive) and event_status
  let filtered = rows;
  if (plateFilter) {
    filtered = filtered.filter((r) =>
      r.vehicle_plate?.includes(plateFilter) || r.ocr_text?.toUpperCase().includes(plateFilter)
    );
  }
  if (event_status) {
    filtered = filtered.filter((r) => r.event_status === event_status);
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSizeNum);

  res.json({
    items,
    total,
    page: pageNum,
    page_size: pageSizeNum,
  });
});

export { router as snapshotsRouter };
