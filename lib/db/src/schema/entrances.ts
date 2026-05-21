import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { villasTable } from "./villas";

/**
 * Entrances — logical access points belonging to a villa.
 * No hardware fields here. Cameras and intercoms (hardware) reference
 * an entrance via their own entrance_id FK.
 */
export const entrancesTable = pgTable(
  "entrances",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    villa_id: text("villa_id").references(() => villasTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("entrances_villa_idx").on(t.villa_id)],
);

export const insertEntranceSchema = createInsertSchema(entrancesTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertEntrance = z.infer<typeof insertEntranceSchema>;
export type Entrance = typeof entrancesTable.$inferSelect;
