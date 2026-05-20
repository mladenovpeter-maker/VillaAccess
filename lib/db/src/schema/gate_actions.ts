import { pgTable, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entrancesTable } from "./entrances";
import { usersTable } from "./users";

export const actionTypeEnum = pgEnum("action_type", ["open_gate", "open_door", "close_gate", "close_door"]);
export const triggeredByEnum = pgEnum("triggered_by", ["ai_auto", "manual", "schedule", "api"]);

/**
 * Gate Actions — log of every gate/barrier command issued.
 * Tied to an Entrance (shared hardware), not to a specific villa.
 */
export const gateActionsTable = pgTable("gate_actions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  // The shared entrance whose gate was actuated
  entrance_id: text("entrance_id").references(() => entrancesTable.id, { onDelete: "set null" }),

  action_type:  actionTypeEnum("action_type").notNull(),
  triggered_by: triggeredByEnum("triggered_by").notNull().default("manual"),
  operator_id:  text("operator_id").references(() => usersTable.id, { onDelete: "set null" }),
  timestamp:    timestamp("timestamp").defaultNow().notNull(),
  success:      boolean("success").notNull().default(true),
  notes:        text("notes"),
});

export const insertGateActionSchema = createInsertSchema(gateActionsTable).omit({ id: true });
export type InsertGateAction = z.infer<typeof insertGateActionSchema>;
export type GateAction = typeof gateActionsTable.$inferSelect;
