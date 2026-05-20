import { pgTable, text, timestamp, pgEnum, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const logTypeEnum = pgEnum("log_type", ["access", "denied", "override", "system", "ai"]);

export const logsTable = pgTable("logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  log_type: logTypeEnum("log_type").notNull(),
  message: text("message").notNull(),
  vehicle_id: text("vehicle_id"),
  villa_id: text("villa_id"),
  operator_id: text("operator_id"),
  snapshot_url: text("snapshot_url"),
  confidence_score: real("confidence_score"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertLogSchema = createInsertSchema(logsTable).omit({ id: true, created_at: true });
export type InsertLog = z.infer<typeof insertLogSchema>;
export type Log = typeof logsTable.$inferSelect;
