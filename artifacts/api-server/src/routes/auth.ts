import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, refreshTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import * as crypto from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "villa_jwt_secret_dev_only";
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "villa_salt_2024").digest("hex");
}

function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function verifyAccessToken(token: string): { sub: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
  } catch {
    return null;
  }
}

async function createRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(64).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  await db.insert(refreshTokensTable).values({
    token_hash: hash,
    user_id: userId,
    expires_at: expiresAt,
  });

  return raw;
}

async function rotateRefreshToken(
  rawToken: string
): Promise<{ userId: string; newRaw: string } | null> {
  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const rows = await db
    .select()
    .from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.token_hash, hash), eq(refreshTokensTable.revoked, false)))
    .limit(1);

  const stored = rows[0];
  if (!stored || stored.expires_at < now) return null;

  // Revoke the used token
  await db
    .update(refreshTokensTable)
    .set({ revoked: true })
    .where(eq(refreshTokensTable.id, stored.id));

  // Issue a new refresh token (rotation)
  const newRaw = await createRefreshToken(stored.user_id);
  return { userId: stored.user_id, newRaw };
}

export async function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }

  const token = auth.slice(7);
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ detail: "Token expired or invalid" });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub))
    .limit(1);

  if (!users[0]) {
    res.status(401).json({ detail: "User not found" });
    return;
  }

  req.user = users[0];
  next();
}

// POST /auth/login
router.post("/login", async (req, res) => {
  const schema = z.object({ username: z.string(), password: z.string() });
  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid request" });
    return;
  }

  const { username, password } = body.data;
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  const user = users[0];

  if (!user || user.password_hash !== hashPassword(password)) {
    res.status(401).json({ detail: "Invalid username or password" });
    return;
  }

  const access_token = signAccessToken(user.id, user.role);
  const refresh_token = await createRefreshToken(user.id);

  res.json({
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 900, // 15 minutes in seconds
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    },
  });
});

// POST /auth/refresh
router.post("/refresh", async (req, res) => {
  const schema = z.object({ refresh_token: z.string() });
  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "refresh_token is required" });
    return;
  }

  const result = await rotateRefreshToken(body.data.refresh_token);
  if (!result) {
    res.status(401).json({ detail: "Refresh token expired or invalid" });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, result.userId))
    .limit(1);

  if (!users[0]) {
    res.status(401).json({ detail: "User not found" });
    return;
  }

  const access_token = signAccessToken(users[0].id, users[0].role);

  res.json({
    access_token,
    refresh_token: result.newRaw,
    token_type: "bearer",
    expires_in: 900,
  });
});

// GET /auth/me
router.get("/me", requireAuth, async (req: any, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
  });
});

// POST /auth/logout
router.post("/logout", requireAuth, async (req: any, res) => {
  const schema = z.object({ refresh_token: z.string().optional() });
  const body = schema.safeParse(req.body);

  if (body.success && body.data.refresh_token) {
    const hash = crypto
      .createHash("sha256")
      .update(body.data.refresh_token)
      .digest("hex");
    await db
      .update(refreshTokensTable)
      .set({ revoked: true })
      .where(eq(refreshTokensTable.token_hash, hash));
  }

  res.json({ message: "Logged out" });
});

export { router as authRouter };
