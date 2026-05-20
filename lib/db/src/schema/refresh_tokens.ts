import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const refreshTokensTable = pgTable("refresh_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  token_hash: text("token_hash").notNull().unique(),
  user_id: text("user_id").notNull(),
  expires_at: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
