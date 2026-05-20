import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

export const reservationStatusEnum = pgEnum("reservation_status", ["upcoming", "active", "completed", "cancelled"]);

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
