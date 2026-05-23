import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../routes/auth";
import { logger } from "./logger";

// Bootstrap-only seeding. Existing users are NEVER modified by this function:
// password_hash, role, and is_active are preserved on restart so operators can
// rotate credentials in the DB without them being clobbered on the next boot.
//
// Initial passwords for first-ever insert come from env vars. Dev fallback
// "12345678" applies ONLY when NODE_ENV !== "production" AND the env var is
// unset. In production the env var is required; missing it logs a loud warning
// and skips that user (it will not be auto-created with a weak default).

const DEV_FALLBACK_PASSWORD = "12345678";

function bootstrapPassword(envVar: string): string | null {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_PASSWORD;
  return null;
}

const DEFAULT_USERS: Array<{
  username: string;
  envVar: string;
  role: "admin" | "operator" | "viewer";
  full_name: string;
}> = [
  { username: "admin",    envVar: "ADMIN_PASSWORD",    role: "admin",    full_name: "System Administrator" },
  { username: "operator", envVar: "OPERATOR_PASSWORD", role: "operator", full_name: "Default Operator" },
  { username: "viewer",   envVar: "VIEWER_PASSWORD",   role: "viewer",   full_name: "Default Viewer" },
];

export async function seedDefaultUsers(): Promise<void> {
  for (const u of DEFAULT_USERS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, u.username))
      .limit(1);

    if (existing[0]) {
      // Bootstrap-only: do NOT touch password_hash / role / is_active for
      // users that already exist. Operators manage these via DB or UI.
      logger.info({ username: u.username }, "Default user already exists; leaving untouched");
      continue;
    }

    const password = bootstrapPassword(u.envVar);
    if (!password) {
      logger.warn(
        { username: u.username, envVar: u.envVar },
        "Skipping default user creation: env var not set in production (no weak default will be used)",
      );
      continue;
    }

    await db.insert(usersTable).values({
      username:      u.username,
      password_hash: hashPassword(password),
      role:          u.role,
      full_name:     u.full_name,
      is_active:     true,
    });
    logger.info(
      { username: u.username, role: u.role, source: process.env[u.envVar] ? "env" : "dev_fallback" },
      "Seeded default user",
    );
  }
}
