import { pgTable, text, timestamp, real, integer, boolean, index } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable(
  "system_settings",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    key: text("key").notNull().unique(),
    value: text("value").notNull(),
    value_type: text("value_type").notNull().default("string"),
    label: text("label").notNull(),
    description: text("description"),
    category: text("category").notNull().default("general"),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
    updated_by: text("updated_by"),
  },
  (t) => [
    index("settings_key_idx").on(t.key),
    index("settings_category_idx").on(t.category),
  ],
);

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
