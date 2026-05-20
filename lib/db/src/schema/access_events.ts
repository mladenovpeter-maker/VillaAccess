import { pgTable, text, timestamp, pgEnum, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entrancesTable } from "./entrances";
import { camerasTable } from "./cameras";

export const eventTypeEnum = pgEnum("event_type", ["entry", "exit", "denied", "manual_open", "override"]);
export const eventStatusEnum = pgEnum("event_status", ["allowed", "denied", "manual", "pending"]);

export const accessEventsTable = pgTable("access_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  event_type: eventTypeEnum("event_type").notNull(),
  status: eventStatusEnum("status").notNull(),
  confidence_score: real("confidence_score"),
  vehicle_id: text("vehicle_id"),
  license_plate: text("license_plate"),
  // Access happened at this shared entrance
  entrance_id: text("entrance_id").references(() => entrancesTable.id, { onDelete: "set null" }),
  // Which camera triggered the event
  camera_id: text("camera_id").references(() => camerasTable.id, { onDelete: "set null" }),
  snapshot_url: text("snapshot_url"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertAccessEventSchema = createInsertSchema(accessEventsTable).omit({ id: true, created_at: true });
export type InsertAccessEvent = z.infer<typeof insertAccessEventSchema>;
export type AccessEvent = typeof accessEventsTable.$inferSelect;
