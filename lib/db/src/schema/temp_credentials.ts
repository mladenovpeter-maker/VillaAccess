import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationsTable } from "./reservations";

export const credentialStatusEnum = pgEnum("credential_status", ["active", "expired", "revoked"]);

// Access tier for a temp credential — mirrors vehicles.access_type semantics.
//   "temporary" (default) — bound to a validity window (valid_from..valid_until).
//                           Covers both reservation-linked PINs and standalone
//                           staff PINs with an explicit end date (cleaner, gardener).
//   "permanent"           — no real end date (manager / owner). Stored with a
//                           far-future valid_until sentinel so Hikvision (which
//                           requires an end time) accepts it; never auto-expires.
export const credentialAccessTypeEnum = pgEnum("temp_credential_access_type", [
  "temporary",
  "permanent",
]);

export const tempCredentialsTable = pgTable("temp_credentials", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Nullable: NULL = standalone staff PIN (no reservation); set = reservation-linked.
  reservation_id: text("reservation_id").references(() => reservationsTable.id, { onDelete: "cascade" }),
  // For standalone PINs — who the PIN belongs to (e.g. "Чистачка Мария", "Управител").
  owner_name: text("owner_name"),
  pin_code: text("pin_code").notNull(),
  label: text("label"),
  notes: text("notes"),
  access_type: credentialAccessTypeEnum("access_type").notNull().default("temporary"),
  valid_from: timestamp("valid_from").notNull(),
  valid_until: timestamp("valid_until").notNull(),
  status: credentialStatusEnum("status").notNull().default("active"),
  // Last intercom push result for standalone PINs ("synced" | "failed" | null).
  // NULL for reservation-linked rows (those reach hardware via the reservation flow).
  sync_status: text("sync_status"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertTempCredentialSchema = createInsertSchema(tempCredentialsTable).omit({ id: true, created_at: true });
export type InsertTempCredential = z.infer<typeof insertTempCredentialSchema>;
export type TempCredential = typeof tempCredentialsTable.$inferSelect;
