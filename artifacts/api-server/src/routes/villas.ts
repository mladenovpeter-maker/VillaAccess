import { Router } from "express";
import { db } from "@workspace/db";
import { villasTable, camerasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function villaWithCameras(villa: typeof villasTable.$inferSelect) {
  const cameras = await db.select({ id: camerasTable.id }).from(camerasTable).where(eq(camerasTable.villa_id, villa.id));
  return {
    id: villa.id,
    name: villa.name,
    gate_id: villa.gate_id,
    door_id: villa.door_id,
    camera_ids: cameras.map((c) => c.id),
    status: villa.status,
  };
}

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(villasTable).orderBy(villasTable.name);
  const result = await Promise.all(rows.map(villaWithCameras));
  res.json(result);
});

router.post("/", requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gate_id: z.string(),
    door_id: z.string(),
    camera_ids: z.array(z.string()).optional(),
    status: z.enum(["active", "inactive", "maintenance"]).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const [villa] = await db.insert(villasTable).values({
    name: body.data.name,
    gate_id: body.data.gate_id,
    door_id: body.data.door_id,
    status: body.data.status ?? "active",
  }).returning();

  res.status(201).json(await villaWithCameras(villa));
});

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(villasTable).where(eq(villasTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await villaWithCameras(rows[0]));
});

router.put("/:id", requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gate_id: z.string(),
    door_id: z.string(),
    camera_ids: z.array(z.string()).optional(),
    status: z.enum(["active", "inactive", "maintenance"]).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const rows = await db.update(villasTable).set({
    name: body.data.name,
    gate_id: body.data.gate_id,
    door_id: body.data.door_id,
    status: body.data.status ?? "active",
    updated_at: new Date(),
  }).where(eq(villasTable.id, req.params.id)).returning();

  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await villaWithCameras(rows[0]));
});

export { router as villasRouter };
