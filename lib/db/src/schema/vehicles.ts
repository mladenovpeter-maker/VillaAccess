import { pgTable, text, timestamp, pgEnum, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehicleTypeEnum = pgEnum("vehicle_type", ["sedan", "suv", "van", "truck", "motorcycle", "other"]);
export const vehicleStatusEnum = pgEnum("vehicle_status", ["known", "unknown", "blacklisted"]);

export const vehiclesTable = pgTable("vehicles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  license_plate: text("license_plate").notNull().unique(),
  make: text("make"),
  model: text("model"),
  color: text("color"),
  vehicle_type: vehicleTypeEnum("vehicle_type"),
  confidence_score: real("confidence_score"),
  status: vehicleStatusEnum("status").notNull().default("unknown"),
  snapshot_url: text("snapshot_url"),
  first_seen: timestamp("first_seen"),
  last_seen: timestamp("last_seen"),
  total_visits: integer("total_visits").notNull().default(0),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
