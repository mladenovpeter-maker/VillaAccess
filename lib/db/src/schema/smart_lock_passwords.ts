import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationsTable } from "./reservations";
import { smartLocksTable } from "./smart_locks";

/**
 * Per-reservation temp-password ledger for smart locks.
 *
 * One row per (reservation, lock, provider_password_id) issued. Revoked
 * rows are kept for audit. See migration 0018 for lifecycle rules.
 */
export const smartLockPasswordStatusEnum = pgEnum("smart_lock_password_status", [
  "active",
  "revoked",
  "failed",
]);

export const smartLockPasswordsTable = pgTable(
  "smart_lock_passwords",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    reservation_id: text("reservation_id")
      .notNull()
      .references(() => reservationsTable.id, { onDelete: "cascade" }),
    smart_lock_id: text("smart_lock_id")
      .notNull()
      .references(() => smartLocksTable.id, { onDelete: "cascade" }),

    /** Opaque provider-side id (e.g. Tuya temp-password "id" field). */
    provider_password_id: text("provider_password_id").notNull(),

    status: smartLockPasswordStatusEnum("status").notNull().default("active"),
    last_error: text("last_error"),

    created_at: timestamp("created_at").defaultNow().notNull(),
    revoked_at: timestamp("revoked_at"),
  },
  (t) => [
    index("slp_reservation_idx").on(t.reservation_id),
    index("slp_lock_idx").on(t.smart_lock_id),
    index("slp_status_idx").on(t.status),
  ],
);

export const insertSmartLockPasswordSchema = createInsertSchema(smartLockPasswordsTable).omit({
  id: true,
  created_at: true,
});
export type InsertSmartLockPassword = z.infer<typeof insertSmartLockPasswordSchema>;
export type SmartLockPassword = typeof smartLockPasswordsTable.$inferSelect;
