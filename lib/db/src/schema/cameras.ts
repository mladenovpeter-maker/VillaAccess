import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

export const cameraStatusEnum = pgEnum("camera_status", ["online", "offline", "error"]);

export const camerasTable = pgTable("cameras", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  ip_address: text("ip_address").notNull(),
  rtsp_url: text("rtsp_url"),
  villa_id: text("villa_id").references(() => villasTable.id, { onDelete: "set null" }),
  status: cameraStatusEnum("status").notNull().default("offline"),
  last_snapshot: timestamp("last_snapshot"),
  snapshot_url: text("snapshot_url"),
  model: text("model"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCameraSchema = createInsertSchema(camerasTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof camerasTable.$inferSelect;
