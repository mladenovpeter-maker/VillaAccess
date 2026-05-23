import { pgTable, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { villasTable } from "./villas";
import { entrancesTable } from "./entrances";

/**
 * villa_entrances — M:N link between villas and entrances.
 *
 * One entrance can serve many villas (typical case: 2-3 shared gates).
 * One villa can be reachable through many entrances (typical case: Main
 * Gate + Service Gate + Parking Entrance).
 *
 * In Phase A.0 (shadow) this table is populated by migration 0016 but
 * read ONLY by the shadow validator path in services/anpr.ts. The live
 * relay decision still flows through entrances.villa_id (the legacy
 * single FK).
 *
 * Cascade on delete: removing a villa or entrance also removes the link
 * rows. No orphan join rows ever.
 */
export const villaEntrancesTable = pgTable(
  "villa_entrances",
  {
    villa_id: text("villa_id")
      .notNull()
      .references(() => villasTable.id, { onDelete: "cascade" }),
    entrance_id: text("entrance_id")
      .notNull()
      .references(() => entrancesTable.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.villa_id, t.entrance_id] }),
    index("villa_entrances_villa_idx").on(t.villa_id),
    index("villa_entrances_entrance_idx").on(t.entrance_id),
  ],
);

export type VillaEntrance = typeof villaEntrancesTable.$inferSelect;
export type InsertVillaEntrance = typeof villaEntrancesTable.$inferInsert;
