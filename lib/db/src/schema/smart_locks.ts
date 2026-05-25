import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

/**
 * Smart Locks — Wi-Fi door locks (currently Tuya ecosystem).
 *
 * One physical lock per villa (the front door). The actual cloud
 * integration is opaque to the database: we only store the device_id
 * and the protocol; all Tuya HTTP / HMAC signing lives in the
 * api-server's lib/locks/tuya adapter.
 *
 * Tuya credentials (Access ID / Access Secret / region) are shared
 * across the whole deployment and live in ENV vars (TUYA_ACCESS_ID,
 * TUYA_ACCESS_SECRET, TUYA_REGION) — NOT per-lock — because one
 * cloud project hosts all the linked locks.
 *
 * Battery + last_seen + status are best-effort runtime fields refreshed
 * by the lock-monitor service (Phase 1 polls on demand from System
 * Health; Phase 4 may add background polling / Pulsar push).
 */
export const smartLockStatusEnum = pgEnum("smart_lock_status", [
  "online",
  "offline",
  "error",
]);

export const smartLockProtocolEnum = pgEnum("smart_lock_protocol", [
  "tuya",
]);

export const smartLocksTable = pgTable(
  "smart_locks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    name: text("name").notNull(),

    // 1:1 with villa — enforced by unique index below.
    villa_id: text("villa_id").references(() => villasTable.id, {
      onDelete: "set null",
    }),

    protocol: smartLockProtocolEnum("protocol").notNull().default("tuya"),

    // Tuya-specific. For other protocols, leave NULL and add per-protocol
    // columns later. Kept as text (not enum) so future additions don't
    // require migrations.
    tuya_device_id: text("tuya_device_id"),

    // ── Runtime status (refreshed by lock-monitor / on-demand) ──────────
    status: smartLockStatusEnum("status").notNull().default("offline"),
    battery_pct: integer("battery_pct"),
    last_seen: timestamp("last_seen"),
    last_status_check: timestamp("last_status_check"),
    last_status_latency_ms: integer("last_status_latency_ms"),
    device_info: text("device_info"), // raw JSON from Tuya, for debug

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Enforce one lock per villa (when villa_id is set).
    uniqueIndex("smart_locks_villa_unique").on(t.villa_id),
    index("smart_locks_status_idx").on(t.status),
    index("smart_locks_protocol_idx").on(t.protocol),
  ],
);

export const insertSmartLockSchema = createInsertSchema(smartLocksTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSmartLock = z.infer<typeof insertSmartLockSchema>;
export type SmartLock = typeof smartLocksTable.$inferSelect;
