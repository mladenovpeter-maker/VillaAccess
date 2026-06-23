import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entranceAccessLevelEnum = pgEnum("entrance_access_level", [
  "public",
  "restricted",
  "admin_only",
]);

/**
 * Entrances — physical/logical access points for the industrial site.
 *
 * Each entrance has an access_level that the role matrix (Phase 2) will use
 * to determine which users / vehicles are allowed through.
 * Cameras and intercoms (hardware) reference an entrance via entrance_id FK.
 */
export const entrancesTable = pgTable(
  "entrances",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    zone: text("zone"),
    description: text("description"),
    access_level: entranceAccessLevelEnum("access_level").notNull().default("public"),
    active: boolean("active").notNull().default(true),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
);

export const insertEntranceSchema = createInsertSchema(entrancesTable).omit({
  id: true, created_at: true, updated_at: true,
});
export type InsertEntrance = z.infer<typeof insertEntranceSchema>;
export type Entrance = typeof entrancesTable.$inferSelect;
