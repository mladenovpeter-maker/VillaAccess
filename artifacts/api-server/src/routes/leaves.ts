import { Router } from "express";
import { db } from "@workspace/db";
import { leavesTable, workersTable } from "@workspace/db";
import { eq, and, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";

export const leavesRouter = Router();

const bodySchema = z.object({
  worker_id:  z.string().min(1),
  type:       z.enum(["vacation", "sick", "business_trip", "other"]).default("vacation"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note:       z.string().optional().nullable(),
});

async function withWorker(leave: typeof leavesTable.$inferSelect) {
  const [worker] = await db.select({
    id: workersTable.id,
    first_name: workersTable.first_name,
    last_name: workersTable.last_name,
    department: workersTable.department,
    employee_number: workersTable.employee_number,
    photo_url: workersTable.photo_url,
  }).from(workersTable).where(eq(workersTable.id, leave.worker_id)).limit(1);
  return { ...leave, worker: worker ?? null };
}

// ─── GET /leaves ─────────────────────────────────────────────────────────────
// ?worker_id=  filter by worker
// ?from=YYYY-MM-DD  leaves ending on or after this date
// ?to=YYYY-MM-DD    leaves starting on or before this date
// ?active=true      only currently-active leaves (today is within range)

leavesRouter.get("/", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const conditions = [];

  if (req.query.worker_id) {
    conditions.push(eq(leavesTable.worker_id, req.query.worker_id as string));
  }
  if (req.query.from) {
    conditions.push(gte(leavesTable.end_date, req.query.from as string));
  }
  if (req.query.to) {
    conditions.push(lte(leavesTable.start_date, req.query.to as string));
  }
  if (req.query.active === "true") {
    conditions.push(lte(leavesTable.start_date, today));
    conditions.push(gte(leavesTable.end_date, today));
  }

  const rows = await db.select().from(leavesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(leavesTable.start_date);

  const enriched = await Promise.all(rows.map(withWorker));
  res.json(enriched);
});

// ─── POST /leaves ─────────────────────────────────────────────────────────────

leavesRouter.post("/", async (req, res) => {
  const body = bodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }
  if (body.data.end_date < body.data.start_date) {
    res.status(400).json({ detail: "end_date must be >= start_date" }); return;
  }

  const [row] = await db.insert(leavesTable).values({
    worker_id:  body.data.worker_id,
    type:       body.data.type,
    start_date: body.data.start_date,
    end_date:   body.data.end_date,
    note:       body.data.note ?? null,
  }).returning();

  res.status(201).json(await withWorker(row));
});

// ─── PUT /leaves/:id ──────────────────────────────────────────────────────────

leavesRouter.put("/:id", async (req, res) => {
  const existing = await db.select().from(leavesTable).where(eq(leavesTable.id, req.params.id)).limit(1);
  if (!existing[0]) { res.status(404).json({ detail: "Leave not found" }); return; }

  const body = bodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }
  if (body.data.end_date < body.data.start_date) {
    res.status(400).json({ detail: "end_date must be >= start_date" }); return;
  }

  const [updated] = await db.update(leavesTable).set({
    worker_id:  body.data.worker_id,
    type:       body.data.type,
    start_date: body.data.start_date,
    end_date:   body.data.end_date,
    note:       body.data.note ?? null,
  }).where(eq(leavesTable.id, req.params.id)).returning();

  res.json(await withWorker(updated));
});

// ─── DELETE /leaves/:id ───────────────────────────────────────────────────────

leavesRouter.delete("/:id", async (req, res) => {
  const existing = await db.select().from(leavesTable).where(eq(leavesTable.id, req.params.id)).limit(1);
  if (!existing[0]) { res.status(404).json({ detail: "Leave not found" }); return; }
  await db.delete(leavesTable).where(eq(leavesTable.id, req.params.id));
  res.status(204).send();
});
