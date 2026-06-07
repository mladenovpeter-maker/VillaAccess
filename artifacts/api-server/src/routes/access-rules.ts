import { Router } from "express";
import { db } from "@workspace/db";
import {
  accessRulesTable,
  workersTable,
  shiftsTable,
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

    const { worker_id, entrance_id, shift_id } = parse.data;

    const [row] = await db
      .insert(accessRulesTable)
      .values({ worker_id, entrance_id, shift_id: shift_id ?? null })
      .onConflictDoUpdate({
        target: [accessRulesTable.worker_id, accessRulesTable.entrance_id],
        set: { shift_id: shift_id ?? null },
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[access-rules] POST /", err);
    res.status(500).json({ detail: "Failed to create access rule" });
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
