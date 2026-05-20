import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as crypto from "crypto";
import { z } from "zod";

const router = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "villa_salt_2024").digest("hex");
}

function generateToken(userId: string): string {
  const payload = { userId, iat: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, "base64url").toString());
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ detail: "Invalid token" });
    return;
  }
  const users = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!users[0]) {
    res.status(401).json({ detail: "User not found" });
    return;
  }
  req.user = users[0];
  next();
}

router.post("/login", async (req, res) => {
  const schema = z.object({ username: z.string(), password: z.string() });
  const body = schema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ detail: "Invalid request" });
    return;
  }

  const { username, password } = body.data;
  const users = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  const user = users[0];

  if (!user || user.password_hash !== hashPassword(password)) {
    res.status(401).json({ detail: "Invalid username or password" });
    return;
  }

  const token = generateToken(user.id);
  res.json({
    access_token: token,
    token_type: "bearer",
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    },
  });
});

router.get("/me", requireAuth, async (req: any, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
  });
});

router.post("/logout", requireAuth, async (_req, res) => {
  res.json({ message: "Logged out" });
});

export { router as authRouter, hashPassword };
