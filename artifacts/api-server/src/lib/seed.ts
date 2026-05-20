import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../routes/auth";
import { logger } from "./logger";

const DEFAULT_USERS: Array<{
  username: string;
  password: string;
  role: "admin" | "operator" | "viewer";
  full_name: string;
}> = [
  { username: "admin",    password: "12345678", role: "admin",    full_name: "System Administrator" },
  { username: "operator", password: "12345678", role: "operator", full_name: "Default Operator" },
  { username: "viewer",   password: "12345678", role: "viewer",   full_name: "Default Viewer" },
];

export async function seedDefaultUsers(): Promise<void> {
  for (const u of DEFAULT_USERS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, u.username))
      .limit(1);

    if (existing[0]) {
      await db.update(usersTable)
        .set({ password_hash: hashPassword(u.password), role: u.role, is_active: true })
        .where(eq(usersTable.username, u.username));
      logger.info({ username: u.username, role: u.role }, "Refreshed default user");
    } else {
      await db.insert(usersTable).values({
        username:      u.username,
        password_hash: hashPassword(u.password),
        role:          u.role,
        full_name:     u.full_name,
        is_active:     true,
      });
      logger.info({ username: u.username, role: u.role }, "Seeded default user");
    }
  }
}
