import { Router } from "express";
import { db } from "@workspace/db";
import { entrancesTable, camerasTable, intercomsTable, villasTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

// ─── Helper: entrance with camera + intercom counts ──────────────────────────

async function enrichEntrance(e: typeof entrancesTable.$inferSelect) {
  const [{ cameras }] = await db
    .select({ cameras: sql<number>`count(*)::int` })
    .from(camerasTable)
    .where(eq(camerasTable.entrance_id, e.id));

  const [{ intercoms }] = await db
    .select({ intercoms: sql<number>`count(*)::int` })
    .from(intercomsTable)
    .where(eq(intercomsTable.entrance_id, e.id));

  return { ...e, camera_count: cameras, intercom_count: intercoms };
}

// ─── GET /entrances ───────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(entrancesTable).orderBy(entrancesTable.name);
  const result = await Promise.all(rows.map(enrichEntrance));
  res.json(result);
});

// ─── GET /entrances/:id ───────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(entrancesTable).where(eq(entrancesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }

  const cameras = await db.select().from(camerasTable).where(eq(camerasTable.entrance_id, rows[0].id));
  const intercoms = await db.select().from(intercomsTable).where(eq(intercomsTable.entrance_id, rows[0].id));

  res.json({ ...rows[0], cameras, intercoms });
});

// ─── POST /entrances ──────────────────────────────────────────────────────────

const createSchema = z.object({
  name:        z.string().min(1),
  villa_id:    z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  active:      z.boolean().optional(),
});

async function validateVilla(villa_id: string | null | undefined) {
  if (!villa_id) return true;
  const v = await db.select({ id: villasTable.id }).from(villasTable)
    .where(eq(villasTable.id, villa_id)).limit(1);
  return !!v[0];
}

router.post("/", requireAuth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  if (!(await validateVilla(body.data.villa_id))) {
    res.status(400).json({ detail: "Villa not found" }); return;
  }

  const [e] = await db.insert(entrancesTable).values({
    name:        body.data.name,
    villa_id:    body.data.villa_id ?? null,
    description: body.data.description ?? null,
    active:      body.data.active ?? true,
  }).returning();

  res.status(201).json(await enrichEntrance(e));
});

// ─── PUT /entrances/:id ───────────────────────────────────────────────────────

router.put("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(entrancesTable).where(eq(entrancesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }

  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  if (!(await validateVilla(body.data.villa_id))) {
    res.status(400).json({ detail: "Villa not found" }); return;
  }

  const [updated] = await db.update(entrancesTable).set({
    name:        body.data.name,
    villa_id:    body.data.villa_id ?? null,
    description: body.data.description ?? null,
    active:      body.data.active ?? rows[0].active,
    updated_at:  new Date(),
  }).where(eq(entrancesTable.id, req.params.id)).returning();

  res.json(await enrichEntrance(updated));
});

// ─── DELETE /entrances/:id ────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(entrancesTable).where(eq(entrancesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }
  await db.delete(entrancesTable).where(eq(entrancesTable.id, req.params.id));
  res.status(204).send();
});

// ─── GET /entrances/:id/cameras ───────────────────────────────────────────────

router.get("/:id/cameras", requireAuth, async (req, res) => {
  const cameras = await db.select().from(camerasTable).where(eq(camerasTable.entrance_id, req.params.id));
  res.json(cameras.map(c => ({ ...c, password: undefined })));
});

// ─── GET /entrances/:id/intercoms ─────────────────────────────────────────────

router.get("/:id/intercoms", requireAuth, async (req, res) => {
  const intercoms = await db.select().from(intercomsTable).where(eq(intercomsTable.entrance_id, req.params.id));
  res.json(intercoms.map(i => ({ ...i, password: undefined })));
});

export { router as entrancesRouter };
