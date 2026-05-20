import { Router } from "express";
import { db } from "@workspace/db";
import { villasTable, reservationsTable, reservationVehiclesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function enrichVilla(villa: typeof villasTable.$inferSelect) {
  const [{ active }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(reservationsTable)
    .where(eq(reservationsTable.villa_id, villa.id));

  let vehicleCount = 0;
  try {
    const [vc] = await db
      .select({ vehicles: sql<number>`count(distinct ${reservationVehiclesTable.vehicle_id})::int` })
      .from(reservationVehiclesTable)
      .innerJoin(reservationsTable, eq(reservationsTable.id, reservationVehiclesTable.reservation_id))
      .where(eq(reservationsTable.villa_id, villa.id));
    vehicleCount = vc?.vehicles ?? 0;
  } catch {
    vehicleCount = 0;
  }

  return {
    id: villa.id,
    name: villa.name,
    description: villa.description,
    location: villa.location,
    status: villa.status,
    active_reservations: active,
    vehicle_count: vehicleCount,
    created_at: villa.created_at,
    updated_at: villa.updated_at,
  };
}

// ─── GET /villas ──────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(villasTable).orderBy(villasTable.name);
  const result = await Promise.all(rows.map(enrichVilla));
  res.json(result);
});

// ─── GET /villas/:id ──────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  if (req.params.id === "reservations") { res.status(400).json({ detail: "Bad route" }); return; }
  const rows = await db.select().from(villasTable).where(eq(villasTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await enrichVilla(rows[0]));
});

// ─── GET /villas/:id/reservations ─────────────────────────────────────────────

router.get("/:id/reservations", requireAuth, async (req, res) => {
  const rows = await db.select().from(reservationsTable)
    .where(eq(reservationsTable.villa_id, req.params.id))
    .orderBy(desc(reservationsTable.check_in))
    .limit(50);
  res.json(rows);
});

// ─── POST /villas ─────────────────────────────────────────────────────────────

const villaSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional().nullable(),
  location:    z.string().optional().nullable(),
  status:      z.enum(["active", "inactive", "maintenance"]).optional(),
});

router.post("/", requireAuth, async (req, res) => {
  const body = villaSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const [villa] = await db.insert(villasTable).values({
    name:        body.data.name,
    description: body.data.description ?? null,
    location:    body.data.location ?? null,
    status:      body.data.status ?? "active",
  }).returning();

  res.status(201).json(await enrichVilla(villa));
});

// ─── PUT /villas/:id ──────────────────────────────────────────────────────────

router.put("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(villasTable).where(eq(villasTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const body = villaSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const [updated] = await db.update(villasTable).set({
    name:        body.data.name,
    description: body.data.description ?? null,
    location:    body.data.location ?? null,
    status:      body.data.status ?? rows[0].status,
    updated_at:  new Date(),
  }).where(eq(villasTable.id, req.params.id)).returning();

  res.json(await enrichVilla(updated));
});

// ─── DELETE /villas/:id ───────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(villasTable).where(eq(villasTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  await db.delete(villasTable).where(eq(villasTable.id, req.params.id));
  res.status(204).send();
});

export { router as villasRouter };
