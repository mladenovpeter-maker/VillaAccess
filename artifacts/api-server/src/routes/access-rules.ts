import { Router } from "express";
import { db } from "@workspace/db";
import {
  accessRulesTable,
  workersTable,
  shiftsTable,
  departmentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

export const accessRulesRouter = Router();

// ─── GET /access-rules ────────────────────────────────────────────────────────
// Optional query: ?worker_id=&entrance_id=

accessRulesRouter.get("/", async (req, res) => {
  try {
    const { worker_id, entrance_id } = req.query as Record<string, string>;

    let rows = await db.select().from(accessRulesTable);

    if (worker_id) rows = rows.filter((r) => r.worker_id === worker_id);
    if (entrance_id) rows = rows.filter((r) => r.entrance_id === entrance_id);

    res.json(rows);
  } catch (err) {
    console.error("[access-rules] GET /", err);
    res.status(500).json({ detail: "Failed to fetch access rules" });
  }
});

// ─── GET /access-rules/matrix ─────────────────────────────────────────────────
// Returns a flat list of all rules, enriched with worker + shift name.

accessRulesRouter.get("/matrix", async (_req, res) => {
  try {
    const [rules, workers, shifts] = await Promise.all([
      db.select().from(accessRulesTable),
      db.select().from(workersTable),
      db.select().from(shiftsTable),
    ]);

    const workerMap = new Map(workers.map((w) => [w.id, w]));
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));

    const enriched = rules.map((r) => ({
      ...r,
      worker: workerMap.get(r.worker_id) ?? null,
      shift: r.shift_id ? (shiftMap.get(r.shift_id) ?? null) : null,
    }));

    res.json(enriched);
  } catch (err) {
    console.error("[access-rules] GET /matrix", err);
    res.status(500).json({ detail: "Failed to fetch matrix" });
  }
});

// ─── POST /access-rules ───────────────────────────────────────────────────────

const createSchema = z.object({
  worker_id: z.string(),
  entrance_id: z.string(),
  shift_id: z.string().nullable().optional(),
});

accessRulesRouter.post("/", async (req, res) => {
  try {
    const parse = createSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const { worker_id, entrance_id } = parse.data;
    let shift_id = parse.data.shift_id ?? null;

    // Auto-fill shift from worker's department default if not explicitly provided
    if (!shift_id) {
      const [worker] = await db
        .select({ department_id: workersTable.department_id })
        .from(workersTable)
        .where(eq(workersTable.id, worker_id))
        .limit(1);

      if (worker?.department_id) {
        const [dept] = await db
          .select({ default_shift_id: departmentsTable.default_shift_id })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, worker.department_id))
          .limit(1);

        if (dept?.default_shift_id) shift_id = dept.default_shift_id;
      }
    }

    const [row] = await db
      .insert(accessRulesTable)
      .values({ worker_id, entrance_id, shift_id, active: true })
      .onConflictDoUpdate({
        target: [accessRulesTable.worker_id, accessRulesTable.entrance_id],
        set: { shift_id, active: true },
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[access-rules] POST /", err);
    res.status(500).json({ detail: "Failed to create access rule" });
  }
});

// ─── PATCH /access-rules/:id ──────────────────────────────────────────────────
// Toggle or update fields on an existing rule (e.g. active=false to disable).

const patchSchema = z.object({
  active: z.boolean().optional(),
  shift_id: z.string().nullable().optional(),
});

accessRulesRouter.patch("/:id", async (req, res) => {
  try {
    const parse = patchSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const updates: Record<string, unknown> = {};
    if (parse.data.active !== undefined) updates["active"] = parse.data.active;
    if (parse.data.shift_id !== undefined) updates["shift_id"] = parse.data.shift_id;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ detail: "No fields to update" });
    }

    const [row] = await db
      .update(accessRulesTable)
      .set(updates as any)
      .where(eq(accessRulesTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Access rule not found" });
    res.json(row);
  } catch (err) {
    console.error("[access-rules] PATCH /:id", err);
    res.status(500).json({ detail: "Failed to update access rule" });
  }
});

// ─── DELETE /access-rules/:id ─────────────────────────────────────────────────

accessRulesRouter.delete("/:id", async (req, res) => {
  try {
    const [row] = await db
      .delete(accessRulesTable)
      .where(eq(accessRulesTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Access rule not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[access-rules] DELETE /:id", err);
    res.status(500).json({ detail: "Failed to delete access rule" });
  }
});

// ─── DELETE /access-rules/by-pair ─────────────────────────────────────────────
// Delete by worker_id + entrance_id (used by matrix toggle)

accessRulesRouter.delete("/by-pair/:workerId/:entranceId", async (req, res) => {
  try {
    await db
      .delete(accessRulesTable)
      .where(
        and(
          eq(accessRulesTable.worker_id, req.params.workerId),
          eq(accessRulesTable.entrance_id, req.params.entranceId),
        ),
      );

    res.status(204).send();
  } catch (err) {
    console.error("[access-rules] DELETE /by-pair", err);
    res.status(500).json({ detail: "Failed to delete access rule" });
  }
});
