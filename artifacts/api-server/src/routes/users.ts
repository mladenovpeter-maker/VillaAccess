import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, ne, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { hashPassword } from "./auth";
import { z } from "zod";

const router = Router();

function safeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    full_name: u.full_name,
    is_active: u.is_active,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

// GET /users
router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(desc(usersTable.created_at));
  res.json(rows.map(safeUser));
});

// GET /users/:id
router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(safeUser(rows[0]));
});

// POST /users
const createSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  role: z.enum(["admin", "operator"]).optional(),
  full_name: z.string().optional(),
});

router.post("/", requireAuth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, body.data.username)).limit(1);
  if (existing[0]) { res.status(409).json({ detail: "Username already taken" }); return; }

  const [user] = await db.insert(usersTable).values({
    username: body.data.username,
    password_hash: hashPassword(body.data.password),
    role: body.data.role ?? "operator",
    full_name: body.data.full_name ?? null,
    is_active: true,
  }).returning();

  res.status(201).json(safeUser(user));
});

// PUT /users/:id
const updateSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  role: z.enum(["admin", "operator"]).optional(),
  full_name: z.string().optional().nullable(),
});

router.put("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const body = updateSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  if (body.data.username && body.data.username !== rows[0].username) {
    const existing = await db.select().from(usersTable).where(eq(usersTable.username, body.data.username)).limit(1);
    if (existing[0]) { res.status(409).json({ detail: "Username already taken" }); return; }
  }

  const [updated] = await db.update(usersTable).set({
    ...(body.data.username ? { username: body.data.username } : {}),
    ...(body.data.role ? { role: body.data.role } : {}),
    ...(body.data.full_name !== undefined ? { full_name: body.data.full_name } : {}),
    updated_at: new Date(),
  }).where(eq(usersTable.id, req.params.id)).returning();

  res.json(safeUser(updated));
});

// POST /users/:id/deactivate
router.post("/:id/deactivate", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const adminCount = await db.select().from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const activeAdmins = adminCount.filter((u) => u.is_active && u.id !== req.params.id);
  if (rows[0].role === "admin" && activeAdmins.length === 0) {
    res.status(400).json({ detail: "Cannot deactivate the last active admin" }); return;
  }

  const [updated] = await db.update(usersTable).set({ is_active: false, updated_at: new Date() })
    .where(eq(usersTable.id, req.params.id)).returning();
  res.json(safeUser(updated));
});

// POST /users/:id/activate
router.post("/:id/activate", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const [updated] = await db.update(usersTable).set({ is_active: true, updated_at: new Date() })
    .where(eq(usersTable.id, req.params.id)).returning();
  res.json(safeUser(updated));
});

// POST /users/:id/reset-password
const resetSchema = z.object({ password: z.string().min(6) });

router.post("/:id/reset-password", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const body = resetSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Password must be at least 6 characters" }); return; }

  await db.update(usersTable).set({ password_hash: hashPassword(body.data.password), updated_at: new Date() })
    .where(eq(usersTable.id, req.params.id));
  res.json({ ok: true });
});

// DELETE /users/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const activeAdmins = await db.select().from(usersTable)
    .where(eq(usersTable.role, "admin"));
  if (rows[0].role === "admin" && activeAdmins.filter((u) => u.id !== req.params.id).length === 0) {
    res.status(400).json({ detail: "Cannot delete the last admin" }); return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, req.params.id));
  res.status(204).send();
});

export { router as usersRouter };
