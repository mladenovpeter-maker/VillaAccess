import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationsTable } from "./reservations";

export const credentialStatusEnum = pgEnum("credential_status", ["active", "expired", "revoked"]);

export const tempCredentialsTable = pgTable("temp_credentials", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  reservation_id: text("reservation_id").notNull().references(() => reservationsTable.id, { onDelete: "cascade" }),
  pin_code: text("pin_code").notNull(),
  label: text("label"),
  notes: text("notes"),
  valid_from: timestamp("valid_from").notNull(),
  valid_until: timestamp("valid_until").notNull(),
  status: credentialStatusEnum("status").notNull().default("active"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertTempCredentialSchema = createInsertSchema(tempCredentialsTable).omit({ id: true, created_at: true });
export type InsertTempCredential = z.infer<typeof insertTempCredentialSchema>;
export type TempCredential = typeof tempCredentialsTable.$inferSelect;
