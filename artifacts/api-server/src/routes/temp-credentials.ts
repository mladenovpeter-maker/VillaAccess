import { Router } from "express";
import { db } from "@workspace/db";
import { tempCredentialsTable, reservationsTable, villasTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function enrichCred(c: typeof tempCredentialsTable.$inferSelect) {
  const res = await db.select({ id: reservationsTable.id, guest_name: reservationsTable.guest_name, villa_id: reservationsTable.villa_id, pin_code: reservationsTable.pin_code })
    .from(reservationsTable).where(eq(reservationsTable.id, c.reservation_id)).limit(1);
  const reservation = res[0] ?? null;

  let villa = null;
  if (reservation?.villa_id) {
    const villas = await db.select({ id: villasTable.id, name: villasTable.name }).from(villasTable).where(eq(villasTable.id, reservation.villa_id)).limit(1);
    villa = villas[0] ?? null;
  }

  const now = new Date();
  let computedStatus = c.status;
  if (c.status === "active" && new Date(c.valid_until) < now) {
    computedStatus = "expired";
    await db.update(tempCredentialsTable).set({ status: "expired" }).where(eq(tempCredentialsTable.id, c.id));
  }

  return { ...c, status: computedStatus, reservation, villa };
}

// GET /temp-credentials
router.get("/", requireAuth, async (req, res) => {
  const { status } = req.query as { status?: string };
  const rows = await db.select().from(tempCredentialsTable).orderBy(desc(tempCredentialsTable.created_at));
  const enriched = await Promise.all(rows.map(enrichCred));
  const filtered = status && status !== "all" ? enriched.filter((c) => c.status === status) : enriched;
  res.json(filtered);
});

// GET /temp-credentials/:id
router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await enrichCred(rows[0]));
});

// POST /temp-credentials
const createSchema = z.object({
  reservation_id: z.string().min(1),
  pin_code: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly 4 digits")
    .optional(),
  label: z.string().optional(),
  notes: z.string().optional(),
  valid_from: z.string(),
  valid_until: z.string(),
});

function generatePin(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

router.post("/", requireAuth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  const reservation = await db.select().from(reservationsTable).where(eq(reservationsTable.id, body.data.reservation_id)).limit(1);
  if (!reservation[0]) { res.status(404).json({ detail: "Reservation not found" }); return; }

  const [cred] = await db.insert(tempCredentialsTable).values({
    reservation_id: body.data.reservation_id,
    pin_code: body.data.pin_code ?? generatePin(),
    label: body.data.label ?? null,
    notes: body.data.notes ?? null,
    valid_from: new Date(body.data.valid_from),
    valid_until: new Date(body.data.valid_until),
    status: "active",
  }).returning();

  res.status(201).json(await enrichCred(cred));
});

// PATCH /temp-credentials/:id
const updateSchema = z.object({
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const body = updateSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const updates: Record<string, unknown> = {};
  if (body.data.label !== undefined) updates.label = body.data.label;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.valid_from) updates.valid_from = new Date(body.data.valid_from);
  if (body.data.valid_until) updates.valid_until = new Date(body.data.valid_until);

  const [updated] = await db.update(tempCredentialsTable).set(updates).where(eq(tempCredentialsTable.id, req.params.id)).returning();
  res.json(await enrichCred(updated));
});

// POST /temp-credentials/:id/revoke
router.post("/:id/revoke", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const [updated] = await db.update(tempCredentialsTable).set({ status: "revoked" })
    .where(eq(tempCredentialsTable.id, req.params.id)).returning();
  res.json(await enrichCred(updated));
});

// DELETE /temp-credentials/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  await db.delete(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id));
  res.status(204).send();
});

export { router as tempCredentialsRouter };
