import { pgTable, text, timestamp, pgEnum, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entrancesTable } from "./entrances";

export const intercomStatusEnum = pgEnum("intercom_status", ["online", "offline", "error"]);
export const intercomProtocolEnum = pgEnum("intercom_protocol", ["hikvision", "dahua", "sip", "generic"]);

/**
 * Intercoms — door-station / video-intercom units at a shared entrance.
 * Handles PIN entry, visitor video calls, and door-release commands.
 */
export const intercomsTable = pgTable("intercoms", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),

  // ── Location ──────────────────────────────────────────────────────────────
  entrance_id: text("entrance_id").references(() => entrancesTable.id, { onDelete: "set null" }),

  // ── Network & credentials ─────────────────────────────────────────────────
  ip_address: text("ip_address").notNull(),
  http_port:  integer("http_port").notNull().default(80),
  username:   text("username").notNull().default("admin"),
  password:   text("password"),

  // ── Integration ───────────────────────────────────────────────────────────
  protocol:   intercomProtocolEnum("protocol").notNull().default("hikvision"),
  door_no:    integer("door_no").notNull().default(1),   // which door relay to trigger

  // ── PIN sync ──────────────────────────────────────────────────────────────
  pin_sync_enabled: boolean("pin_sync_enabled").notNull().default(true),
  last_sync_status: text("last_sync_status"),
  last_sync_at:     timestamp("last_sync_at"),

  // ── Runtime ───────────────────────────────────────────────────────────────
  status:               intercomStatusEnum("status").notNull().default("offline"),
  last_status_check:    timestamp("last_status_check"),
  last_status_latency_ms: integer("last_status_latency_ms"),
  device_info:          text("device_info"),            // JSON blob

  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIntercomSchema = createInsertSchema(intercomsTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertIntercom = z.infer<typeof insertIntercomSchema>;
export type Intercom = typeof intercomsTable.$inferSelect;
