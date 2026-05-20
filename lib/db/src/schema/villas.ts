import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const villaStatusEnum = pgEnum("villa_status", ["active", "inactive", "maintenance"]);

/**
 * Villas — logical reservation / billing units ONLY.
 *
 * Villas do NOT own hardware. Cameras, intercoms and gates belong to
 * Entrances (shared infrastructure). Access decisions are made by
 * checking whether the arriving vehicle has a valid reservation for
 * any villa within the active window, then opening the shared entrance.
 */
export const villasTable = pgTable("villas", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  status: villaStatusEnum("status").notNull().default("active"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVillaSchema = createInsertSchema(villasTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertVilla = z.infer<typeof insertVillaSchema>;
export type Villa = typeof villasTable.$inferSelect;
