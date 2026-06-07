import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

export const shiftsRouter = Router();

const shiftBodySchema = z.object({
  name: z.string().min(1),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM"),
  days_of_week: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// ─── GET /shifts ──────────────────────────────────────────────────────────────

shiftsRouter.get("/", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(shiftsTable)
      .orderBy(shiftsTable.name);
    res.json(rows);
  } catch (err) {
    console.error("[shifts] GET /shifts", err);
    res.status(500).json({ detail: "Failed to fetch shifts" });
  }
});

// ─── GET /shifts/:id ──────────────────────────────────────────────────────────

shiftsRouter.get("/:id", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.id, req.params.id))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ detail: "Shift not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[shifts] GET /:id", err);
    res.status(500).json({ detail: "Failed to fetch shift" });
  }
});

// ─── POST /shifts ─────────────────────────────────────────────────────────────

shiftsRouter.post("/", async (req, res) => {
  try {
    const parse = shiftBodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db
      .insert(shiftsTable)
      .values({ ...parse.data, updated_at: new Date() })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[shifts] POST /shifts", err);
    res.status(500).json({ detail: "Failed to create shift" });
  }
});

// ─── PUT /shifts/:id ──────────────────────────────────────────────────────────

shiftsRouter.put("/:id", async (req, res) => {
  try {
    const parse = shiftBodySchema.partial().safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db
      .update(shiftsTable)
      .set({ ...parse.data, updated_at: new Date() })
      .where(eq(shiftsTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Shift not found" });
    res.json(row);
  } catch (err) {
    console.error("[shifts] PUT /:id", err);
    res.status(500).json({ detail: "Failed to update shift" });
  }
});

// ─── DELETE /shifts/:id ───────────────────────────────────────────────────────

shiftsRouter.delete("/:id", async (req, res) => {
  try {
    const [row] = await db
      .delete(shiftsTable)
      .where(eq(shiftsTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Shift not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[shifts] DELETE /:id", err);
    res.status(500).json({ detail: "Failed to delete shift" });
  }
});
