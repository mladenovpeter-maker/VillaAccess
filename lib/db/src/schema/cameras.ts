import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entrancesTable } from "./entrances";

export const cameraStatusEnum = pgEnum("camera_status", [
  "online",
  "offline",
  "error",
]);

export const cameraProtocolEnum = pgEnum("camera_protocol", [
  "hikvision",
  "dahua",
  "onvif",
  "rtsp",
]);

/**
 * Cameras — ANPR / surveillance / snapshot devices assigned to an Entrance.
 *
 * Cameras are imaging devices only. They expose:
 *   - snapshot capture
 *   - status / ping
 *   - one optional gate relay output (gate_no) — for cameras with an on-board
 *     I/O relay (e.g. Hikvision ANPR cameras with built-in alarm output).
 *
 * Cameras are NOT access terminals. PIN entry, door release, and access-control
 * ISAPI calls live on the Intercoms table.
 */
export const camerasTable = pgTable(
  "cameras",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    name: text("name").notNull(),
    ip_address: text("ip_address").notNull(),
    rtsp_url: text("rtsp_url"),

    // ── Location — cameras belong to an Entrance ─────────────────────────
    entrance_id: text("entrance_id").references(() => entrancesTable.id, {
      onDelete: "set null",
    }),

    model: text("model"),

    // ── Integration protocol ─────────────────────────────────────────────
    protocol: cameraProtocolEnum("protocol").notNull().default("hikvision"),
    http_port: integer("http_port").notNull().default(80),

    // ── Credentials (⚠ encrypt at rest in production) ────────────────────
    username: text("username").notNull().default("admin"),
    password: text("password"),

    // ── Stream & relay config ────────────────────────────────────────────
    channel_no: integer("channel_no").notNull().default(1),
    gate_no: integer("gate_no").notNull().default(1), // on-board relay output

    // ── Runtime status & snapshots ───────────────────────────────────────
    status: cameraStatusEnum("status").notNull().default("offline"),
    last_snapshot: timestamp("last_snapshot"),
    snapshot_url: text("snapshot_url"),
    last_status_check: timestamp("last_status_check"),
    last_status_latency_ms: integer("last_status_latency_ms"),
    device_info: text("device_info"),

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("cameras_entrance_idx").on(t.entrance_id),
    index("cameras_status_idx").on(t.status),
    index("cameras_protocol_idx").on(t.protocol),
  ],
);

export const insertCameraSchema = createInsertSchema(camerasTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof camerasTable.$inferSelect;
