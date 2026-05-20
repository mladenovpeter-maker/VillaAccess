import { pgTable, text, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entranceStatusEnum = pgEnum("entrance_status", ["active", "inactive", "maintenance"]);

/**
 * Entrances — shared physical access points (gates, barriers).
 * All hardware (cameras, intercoms) is assigned to an entrance, NOT to a villa.
 * Villas are purely logical reservation/billing units.
 */
export const entrancesTable = pgTable("entrances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),                   // "Main Gate", "Service Entrance"
  description: text("description"),
  location: text("location"),                     // Physical location notes
  status: entranceStatusEnum("status").notNull().default("active"),

  // ── Gate/barrier relay config ─────────────────────────────────────────────
  // If the gate is controlled directly (e.g. via a relay IP), store it here.
  // Cameras may also carry relay outputs — those are on the camera row.
  gate_relay_ip:      text("gate_relay_ip"),
  gate_relay_port:    integer("gate_relay_port").default(80),
  gate_relay_channel: integer("gate_relay_channel").default(1),

  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEntranceSchema = createInsertSchema(entrancesTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertEntrance = z.infer<typeof insertEntranceSchema>;
export type Entrance = typeof entrancesTable.$inferSelect;
