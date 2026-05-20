import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

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

export const camerasTable = pgTable(
  "cameras",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    name: text("name").notNull(),
    ip_address: text("ip_address").notNull(),
    rtsp_url: text("rtsp_url"),
    villa_id: text("villa_id").references(() => villasTable.id, {
      onDelete: "set null",
    }),
    model: text("model"),

    // ── Integration protocol ─────────────────────────────────────────────
    protocol: cameraProtocolEnum("protocol").notNull().default("hikvision"),
    http_port: integer("http_port").notNull().default(80),

    // ── Credentials (⚠ encrypt at rest in production) ────────────────────
    username: text("username").notNull().default("admin"),
    password: text("password"),               // null = not yet configured

    // ── Stream & access-control config ───────────────────────────────────
    channel_no: integer("channel_no").notNull().default(1),
    use_access_control: boolean("use_access_control").notNull().default(false),
    gate_no: integer("gate_no").notNull().default(1),
    door_no: integer("door_no").notNull().default(2),

    // ── Runtime status & snapshots ───────────────────────────────────────
    status: cameraStatusEnum("status").notNull().default("offline"),
    last_snapshot: timestamp("last_snapshot"),
    snapshot_url: text("snapshot_url"),
    last_status_check: timestamp("last_status_check"),
    last_status_latency_ms: integer("last_status_latency_ms"),
    device_info: text("device_info"),         // JSON blob of DeviceInfo

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("cameras_villa_idx").on(t.villa_id),
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
