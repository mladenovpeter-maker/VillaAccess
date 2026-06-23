/**
 * Departments CRUD
 * GET    /departments          → list all
 * GET    /departments/:id      → single
 * POST   /departments          → create
 * PUT    /departments/:id      → update
 * DELETE /departments/:id      → soft-delete (active=false)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { departmentsTable, workersTable, shiftsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { z } from "zod/v4";

export const departmentsRouter = Router();

const bodySchema = z.object({
  name: z.string().min(1),
  default_shift_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

// ─── GET /departments ─────────────────────────────────────────────────────────

departmentsRouter.get("/", async (_req, res) => {
  try {
    const depts = await db.select().from(departmentsTable).orderBy(departmentsTable.name);

    // Enrich with default shift name + worker count
    const shifts = await db.select().from(shiftsTable);
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));

    const workerCounts = await db
      .select({ department_id: workersTable.department_id, cnt: count() })
      .from(workersTable)
      .where(eq(workersTable.active, true))
      .groupBy(workersTable.department_id);

    const countMap = new Map(workerCounts.map((r) => [r.department_id, Number(r.cnt)]));

    const enriched = depts.map((d) => ({
      ...d,
      default_shift: d.default_shift_id ? (shiftMap.get(d.default_shift_id) ?? null) : null,
      worker_count: countMap.get(d.id) ?? 0,
    }));

    res.json(enriched);
  } catch (err) {
    console.error("[departments] GET /", err);
    res.status(500).json({ detail: "Failed to fetch departments" });
  }
});

// ─── GET /departments/:id ─────────────────────────────────────────────────────

departmentsRouter.get("/:id", async (req, res) => {
  try {
    const rows = await db.select().from(departmentsTable).where(eq(departmentsTable.id, req.params.id)).limit(1);
    if (!rows[0]) return res.status(404).json({ detail: "Department not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[departments] GET /:id", err);
    res.status(500).json({ detail: "Failed to fetch department" });
  }
});

// ─── POST /departments ────────────────────────────────────────────────────────

departmentsRouter.post("/", async (req, res) => {
  try {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db.insert(departmentsTable)
      .values({ ...parse.data, updated_at: new Date() })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ detail: "Department name already exists" });
    console.error("[departments] POST /", err);
    res.status(500).json({ detail: "Failed to create department" });
  }
});

// ─── PUT /departments/:id ─────────────────────────────────────────────────────

departmentsRouter.put("/:id", async (req, res) => {
  try {
    const parse = bodySchema.partial().safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db.update(departmentsTable)
      .set({ ...parse.data, updated_at: new Date() })
      .where(eq(departmentsTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Department not found" });

    // Keep workers.department text in sync with the new name
    if (parse.data.name) {
      await db.update(workersTable)
        .set({ department: parse.data.name })
        .where(eq(workersTable.department_id, req.params.id));
    }

    res.json(row);
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ detail: "Department name already exists" });
    console.error("[departments] PUT /:id", err);
    res.status(500).json({ detail: "Failed to update department" });
  }
});

// ─── DELETE /departments/:id ──────────────────────────────────────────────────
// Soft-delete only. Workers keep their department_id (still points to inactive dept).

departmentsRouter.delete("/:id", async (req, res) => {
  try {
    const [row] = await db.update(departmentsTable)
      .set({ active: false, updated_at: new Date() })
      .where(eq(departmentsTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Department not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[departments] DELETE /:id", err);
    res.status(500).json({ detail: "Failed to deactivate department" });
  }
});
