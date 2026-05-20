import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { villasTable } from "./villas";
import { camerasTable } from "./cameras";

/**
 * Centralized domain event log.
 *
 * All five event domains are unified here:
 *   vehicle     → vehicle.created | vehicle.updated | vehicle.detected |
 *                  vehicle.recognized | vehicle.unrecognized |
 *                  vehicle.blacklisted | vehicle.unblacklisted
 *   gate        → gate.opened | gate.failed | gate.door_opened | gate.door_failed
 *   access      → access.granted | access.denied | access.manual_override
 *   ai          → ai.snapshot_uploaded | ai.plate_read | ai.confidence_low |
 *                  ai.fingerprint_updated | ai.recognition_complete
 *   reservation → reservation.created | reservation.updated |
 *                  reservation.checked_in | reservation.checked_out |
 *                  reservation.cancelled | reservation.expired
 *
 * This table is append-only — events are never mutated after creation.
 * The payload JSONB field carries event-specific structured data.
 */
export const domainEventsTable = pgTable(
  "domain_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    event_type: text("event_type").notNull(),   // e.g. 'gate.opened'
    category: text("category").notNull(),        // 'gate' | 'vehicle' | 'access' | 'ai' | 'reservation'
    severity: text("severity").notNull().default("info"), // 'info' | 'warning' | 'error' | 'critical'
    payload: jsonb("payload"),                   // event-specific structured data (nullable)

    // ── Denormalized foreign refs (nullable, all SET NULL on delete) ─────────
    vehicle_id: text("vehicle_id").references(() => vehiclesTable.id, {
      onDelete: "set null",
    }),
    villa_id: text("villa_id").references(() => villasTable.id, {
      onDelete: "set null",
    }),
    camera_id: text("camera_id").references(() => camerasTable.id, {
      onDelete: "set null",
    }),
    reservation_id: text("reservation_id"),      // soft ref — no FK to avoid circular deps
    operator_id: text("operator_id"),            // user id of operator (if human-triggered)

    // ── Source metadata ───────────────────────────────────────────────────────
    source: text("source").notNull().default("api"), // 'dashboard' | 'camera' | 'ai_worker' | 'api'
    ip_address: text("ip_address"),

    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("domain_events_category_idx").on(t.category),
    index("domain_events_event_type_idx").on(t.event_type),
    index("domain_events_severity_idx").on(t.severity),
    index("domain_events_vehicle_idx").on(t.vehicle_id),
    index("domain_events_villa_idx").on(t.villa_id),
    index("domain_events_camera_idx").on(t.camera_id),
    index("domain_events_created_idx").on(t.created_at),
    index("domain_events_source_idx").on(t.source),
  ],
);

export type DomainEventRow = typeof domainEventsTable.$inferSelect;
export type InsertDomainEvent = typeof domainEventsTable.$inferInsert;
