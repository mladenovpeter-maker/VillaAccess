import { pgTable, text, timestamp, pgEnum, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entrancesTable } from "./entrances";

export const intercomStatusEnum = pgEnum("intercom_status", ["online", "offline", "error"]);
export const intercomProtocolEnum = pgEnum("intercom_protocol", ["hikvision", "dahua", "sip", "generic"]);

/**
 * Intercoms / Access Terminals — door-station, PIN-entry, and access-control
 * devices (e.g. Hikvision DS-K1T344MX-E1). These use access-control ISAPI
 * endpoints (UserInfo/SetUp, RemoteControl/door) — NOT camera ISAPI.
 *
 * Each intercom is assigned to a shared Entrance.
 */
export const intercomsTable = pgTable(
  "intercoms",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),

    // ── Location ────────────────────────────────────────────────────────────
    entrance_id: text("entrance_id").references(() => entrancesTable.id, { onDelete: "set null" }),

    // ── Network & credentials ───────────────────────────────────────────────
    ip_address: text("ip_address").notNull(),
    http_port:  integer("http_port").notNull().default(80),
    username:   text("username").notNull().default("admin"),
    password:   text("password"),

    // ── Integration ─────────────────────────────────────────────────────────
    protocol:    intercomProtocolEnum("protocol").notNull().default("hikvision"),
    device_type: text("device_type"),                       // e.g. "DS-K1T344MX-E1"
    relay_no:    integer("relay_no").notNull().default(1),  // door/relay number to trigger

    // ── ACS device capabilities ─────────────────────────────────────────────
    door_count:       integer("door_count").default(1),          // number of doors managed
    lock_type:        text("lock_type"),                         // "electric_lock" | "magnetic" | "strike" | …
    pin_support:      boolean("pin_support").default(true),      // device supports PIN codes
    schedule_support: boolean("schedule_support").default(false), // device supports time schedules

    // ── PIN sync ────────────────────────────────────────────────────────────
    pin_sync_enabled: boolean("pin_sync_enabled").notNull().default(true),
    last_sync_status: text("last_sync_status"),
    last_sync_at:     timestamp("last_sync_at"),

    // ── Runtime ─────────────────────────────────────────────────────────────
    status:                 intercomStatusEnum("status").notNull().default("offline"),
    last_status_check:      timestamp("last_status_check"),
    last_status_latency_ms: integer("last_status_latency_ms"),
    device_info:            text("device_info"),

    notes: text("notes"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("intercoms_entrance_idx").on(t.entrance_id),
    index("intercoms_status_idx").on(t.status),
  ],
);

export const insertIntercomSchema = createInsertSchema(intercomsTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertIntercom = z.infer<typeof insertIntercomSchema>;
export type Intercom = typeof intercomsTable.$inferSelect;
