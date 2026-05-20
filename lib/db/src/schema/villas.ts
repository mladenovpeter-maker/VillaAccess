import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const villaStatusEnum = pgEnum("villa_status", ["active", "inactive", "maintenance"]);

export const villasTable = pgTable("villas", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  gate_id: text("gate_id").notNull(),
  door_id: text("door_id").notNull(),
  status: villaStatusEnum("status").notNull().default("active"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVillaSchema = createInsertSchema(villasTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertVilla = z.infer<typeof insertVillaSchema>;
export type Villa = typeof villasTable.$inferSelect;
