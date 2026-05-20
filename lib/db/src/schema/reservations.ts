import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

export const reservationStatusEnum = pgEnum("reservation_status", ["upcoming", "active", "completed", "cancelled"]);
export const pinSyncStatusEnum = pgEnum("pin_sync_status", ["pending", "synced", "failed", "revoked", "not_applicable"]);

export const reservationsTable = pgTable("reservations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  guest_name: text("guest_name").notNull(),
  guest_phone: text("guest_phone"),
  guest_email: text("guest_email"),
  villa_id: text("villa_id").notNull().references(() => villasTable.id, { onDelete: "cascade" }),
  check_in: timestamp("check_in").notNull(),
  check_out: timestamp("check_out").notNull(),
  status: reservationStatusEnum("status").notNull().default("upcoming"),
  notes: text("notes"),
  pin_code: text("pin_code"),
  pin_valid_from: timestamp("pin_valid_from"),
  pin_valid_to: timestamp("pin_valid_to"),
  pin_sync_status: pinSyncStatusEnum("pin_sync_status").notNull().default("pending"),
  pin_last_synced_at: timestamp("pin_last_synced_at"),
  actual_check_in: timestamp("actual_check_in"),
  actual_check_out: timestamp("actual_check_out"),
  cancelled_at: timestamp("cancelled_at"),
  cancelled_by: text("cancelled_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const reservationVehiclesTable = pgTable("reservation_vehicles", {
  reservation_id: text("reservation_id").notNull().references(() => reservationsTable.id, { onDelete: "cascade" }),
  vehicle_id: text("vehicle_id").notNull(),
});

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type Reservation = typeof reservationsTable.$inferSelect;
