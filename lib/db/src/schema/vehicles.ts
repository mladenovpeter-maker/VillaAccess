import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  real,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehicleTypeEnum = pgEnum("vehicle_type", [
  "sedan",
  "suv",
  "van",
  "truck",
  "motorcycle",
  "other",
]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "known",
  "unknown",
  "blacklisted",
]);

// ─── AI fingerprint shape stored in the jsonb column ─────────────────────────
export interface AiFingerprint {
  embedding: number[];          // feature vector from AI model (e.g. 128-dim)
  model_version: string;        // e.g. "yolov8-lp-v3"
  extracted_at: string;         // ISO-8601
  plate_confidence: number;     // 0-1
  vehicle_confidence: number;   // 0-1
  ocr_candidates: string[];     // top-N OCR readings before final selection
  color_histogram?: number[];   // optional 12-bin HSV histogram
}

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // ── Core identity ──────────────────────────────────────────────────────────
    license_plate: text("license_plate").notNull().unique(),
    plate_region: text("plate_region"),          // ISO country/region, e.g. "ID-BA"
    make: text("make"),
    model: text("model"),
    color: text("color"),
    vehicle_type: vehicleTypeEnum("vehicle_type"),
    owner_name: text("owner_name"),              // optional, manually set

    // ── AI recognition ────────────────────────────────────────────────────────
    ai_fingerprint: jsonb("ai_fingerprint").$type<AiFingerprint>(),
    confidence_score: real("confidence_score"),  // latest recognition confidence (0-1)

    // ── Status & blacklist ────────────────────────────────────────────────────
    status: vehicleStatusEnum("status").notNull().default("unknown"),
    blacklist_reason: text("blacklist_reason"),
    blacklisted_at: timestamp("blacklisted_at"),
    blacklisted_by: text("blacklisted_by"),      // operator user id

    // ── Visit tracking ────────────────────────────────────────────────────────
    first_seen: timestamp("first_seen"),
    last_seen: timestamp("last_seen"),
    total_visits: integer("total_visits").notNull().default(0),

    // ── Primary snapshot (thumbnail of best match) ────────────────────────────
    snapshot_url: text("snapshot_url"),          // full frame
    thumbnail_url: text("thumbnail_url"),        // cropped plate region

    notes: text("notes"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("vehicles_status_idx").on(t.status),
    index("vehicles_last_seen_idx").on(t.last_seen),
    index("vehicles_plate_region_idx").on(t.plate_region),
  ]
);

// ─── Vehicle snapshots ────────────────────────────────────────────────────────
// One row per physical camera capture — vehicles can have thousands of these.
export const vehicleSnapshotsTable = pgTable(
  "vehicle_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    vehicle_id: text("vehicle_id").notNull(),        // FK → vehicles.id
    access_event_id: text("access_event_id"),        // FK → access_events.id (nullable)
    camera_id: text("camera_id"),

    // ── Image assets ──────────────────────────────────────────────────────────
    snapshot_url: text("snapshot_url").notNull(),    // full-frame image
    thumbnail_url: text("thumbnail_url"),            // plate crop
    plate_crop_url: text("plate_crop_url"),          // tightest plate crop for OCR debug

    // ── Recognition metadata ──────────────────────────────────────────────────
    confidence_score: real("confidence_score"),
    ocr_text: text("ocr_text"),                      // raw OCR output before normalisation
    ai_annotations: jsonb("ai_annotations").$type<{
      bounding_box?: { x: number; y: number; w: number; h: number };
      detected_plate?: string;
      detected_color?: string;
      detected_type?: string;
      model_version?: string;
    }>(),

    // ── Flags ─────────────────────────────────────────────────────────────────
    is_primary: boolean("is_primary").notNull().default(false),
    captured_at: timestamp("captured_at").defaultNow().notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("vehicle_snapshots_vehicle_idx").on(t.vehicle_id),
    index("vehicle_snapshots_event_idx").on(t.access_event_id),
    index("vehicle_snapshots_captured_idx").on(t.captured_at),
    index("vehicle_snapshots_primary_idx").on(t.vehicle_id, t.is_primary),
  ]
);

// ─── Zod schemas ──────────────────────────────────────────────────────────────
export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;

export const insertVehicleSnapshotSchema = createInsertSchema(
  vehicleSnapshotsTable
).omit({ id: true, created_at: true });
export type InsertVehicleSnapshot = z.infer<typeof insertVehicleSnapshotSchema>;
export type VehicleSnapshot = typeof vehicleSnapshotsTable.$inferSelect;
