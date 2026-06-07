import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";

// ─── Workers ──────────────────────────────────────────────────────────────────

export const workersTable = pgTable(
  "workers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    employee_number: text("employee_number").unique(),
    badge_no: text("badge_no").unique(),
    photo_url: text("photo_url"),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    position: text("position"),
    department: text("department"),
    phone: text("phone"),
    email: text("email"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("workers_active_idx").on(t.active),
  ]
);

export type Worker = typeof workersTable.$inferSelect;

// ─── Shifts ───────────────────────────────────────────────────────────────────
// days_of_week: JS day numbers array [0..6] (0=Sunday).

export const shiftsTable = pgTable("shifts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  name: text("name").notNull(),
  start_time: text("start_time").notNull(),   // "HH:MM" 24-h
  end_time: text("end_time").notNull(),        // "HH:MM" 24-h
  days_of_week: jsonb("days_of_week")
    .$type<number[]>()
    .notNull()
    .default([0, 1, 2, 3, 4, 5, 6]),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),

  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Shift = typeof shiftsTable.$inferSelect;

// ─── Access rules ─────────────────────────────────────────────────────────────
// One row = worker CAN enter the given entrance.
// shift_id nullable → allowed 24/7 (no time restriction).

export const accessRulesTable = pgTable(
  "access_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    worker_id: text("worker_id").notNull(),
    entrance_id: text("entrance_id").notNull(),
    shift_id: text("shift_id"),               // FK → shifts.id (nullable = 24/7)
    active: boolean("active").notNull().default(true),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("access_rules_worker_entrance_uq").on(t.worker_id, t.entrance_id),
    index("access_rules_worker_idx").on(t.worker_id),
    index("access_rules_entrance_idx").on(t.entrance_id),
  ]
);

export type AccessRule = typeof accessRulesTable.$inferSelect;

// ─── Worker ↔ Vehicle junction ────────────────────────────────────────────────

export const workerVehiclesTable = pgTable(
  "worker_vehicles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    worker_id: text("worker_id").notNull(),
    vehicle_id: text("vehicle_id").notNull(),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("worker_vehicles_uq").on(t.worker_id, t.vehicle_id),
    index("worker_vehicles_worker_idx").on(t.worker_id),
    index("worker_vehicles_vehicle_idx").on(t.vehicle_id),
  ]
);

export type WorkerVehicle = typeof workerVehiclesTable.$inferSelect;
