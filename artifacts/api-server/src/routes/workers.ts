import { Router } from "express";
import { db } from "@workspace/db";
import {
  workersTable,
  workerVehiclesTable,
  vehiclesTable,
  accessRulesTable,
} from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { z } from "zod/v4";

export const workersRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const workerBodySchema = z.object({
  employee_number: z.string().optional().nullable(),
  badge_no: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  position: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  department_id: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// ─── GET /workers ─────────────────────────────────────────────────────────────

workersRouter.get("/", async (req, res) => {
  try {
    const { search, active } = req.query as Record<string, string>;

    let rows = await db.select().from(workersTable);

    if (active !== undefined) {
      const isActive = active === "true";
      rows = rows.filter((w) => w.active === isActive);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (w) =>
          w.first_name.toLowerCase().includes(q) ||
          w.last_name.toLowerCase().includes(q) ||
          (w.employee_number ?? "").toLowerCase().includes(q) ||
          (w.department ?? "").toLowerCase().includes(q) ||
          (w.position ?? "").toLowerCase().includes(q),
      );
    }

    rows.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    );

    res.json(rows);
  } catch (err) {
    console.error("[workers] GET /workers", err);
    res.status(500).json({ detail: "Failed to fetch workers" });
  }
});

// ─── GET /workers/:id ─────────────────────────────────────────────────────────

workersRouter.get("/:id", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(workersTable)
      .where(eq(workersTable.id, req.params.id))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ detail: "Worker not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[workers] GET /:id", err);
    res.status(500).json({ detail: "Failed to fetch worker" });
  }
});

// ─── POST /workers ────────────────────────────────────────────────────────────

workersRouter.post("/", async (req, res) => {
  try {
    const parse = workerBodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db
      .insert(workersTable)
      .values({
        ...parse.data,
        updated_at: new Date(),
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ detail: "Employee number already exists" });
    }
    console.error("[workers] POST /workers", err);
    res.status(500).json({ detail: "Failed to create worker" });
  }
});

// ─── PUT /workers/:id ─────────────────────────────────────────────────────────

workersRouter.put("/:id", async (req, res) => {
  try {
    const parse = workerBodySchema.partial().safeParse(req.body);
    if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

    const [row] = await db
      .update(workersTable)
      .set({ ...parse.data, updated_at: new Date() })
      .where(eq(workersTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Worker not found" });
    res.json(row);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ detail: "Employee number already exists" });
    }
    console.error("[workers] PUT /:id", err);
    res.status(500).json({ detail: "Failed to update worker" });
  }
});

// ─── DELETE /workers/:id ──────────────────────────────────────────────────────
// Soft-delete: sets active=false. Preserves audit trail and linked vehicles/rules.
// Hard delete is available via DELETE /workers/:id/hard for explicit admin action.

workersRouter.delete("/:id", async (req, res) => {
  try {
    const [row] = await db
      .update(workersTable)
      .set({ active: false, updated_at: new Date() })
      .where(eq(workersTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Worker not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[workers] DELETE /:id", err);
    res.status(500).json({ detail: "Failed to deactivate worker" });
  }
});

// ─── DELETE /workers/:id/hard ─────────────────────────────────────────────────
// Hard-delete: permanently removes the worker and all linked records (cascade).
// Requires explicit admin intent. Use only for data correction, not deactivation.

workersRouter.delete("/:id/hard", async (req, res) => {
  try {
    const [row] = await db
      .delete(workersTable)
      .where(eq(workersTable.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ detail: "Worker not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[workers] DELETE /:id/hard", err);
    res.status(500).json({ detail: "Failed to delete worker" });
  }
});

// ─── GET /workers/:id/vehicles ────────────────────────────────────────────────

workersRouter.get("/:id/vehicles", async (req, res) => {
  try {
    const links = await db
      .select()
      .from(workerVehiclesTable)
      .where(eq(workerVehiclesTable.worker_id, req.params.id));

    if (!links.length) return res.json([]);

    const vehicleIds = links.map((l) => l.vehicle_id);
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(
        or(...vehicleIds.map((id) => eq(vehiclesTable.id, id)))
      );

    res.json(vehicles);
  } catch (err) {
    console.error("[workers] GET /:id/vehicles", err);
    res.status(500).json({ detail: "Failed to fetch worker vehicles" });
  }
});

// ─── POST /workers/:id/vehicles ───────────────────────────────────────────────

workersRouter.post("/:id/vehicles", async (req, res) => {
  try {
    const { vehicle_id } = z.object({ vehicle_id: z.string() }).parse(req.body);

    const vehicle = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicle_id))
      .limit(1);

    if (!vehicle[0]) return res.status(404).json({ detail: "Vehicle not found" });

    const [link] = await db
      .insert(workerVehiclesTable)
      .values({ worker_id: req.params.id, vehicle_id })
      .onConflictDoNothing()
      .returning();

    res.status(201).json(link ?? { worker_id: req.params.id, vehicle_id });
  } catch (err) {
    console.error("[workers] POST /:id/vehicles", err);
    res.status(500).json({ detail: "Failed to link vehicle" });
  }
});

// ─── DELETE /workers/:id/vehicles/:vehicleId ──────────────────────────────────

workersRouter.delete("/:id/vehicles/:vehicleId", async (req, res) => {
  try {
    await db
      .delete(workerVehiclesTable)
      .where(
        and(
          eq(workerVehiclesTable.worker_id, req.params.id),
          eq(workerVehiclesTable.vehicle_id, req.params.vehicleId),
        ),
      );

    res.status(204).send();
  } catch (err) {
    console.error("[workers] DELETE /:id/vehicles/:vehicleId", err);
    res.status(500).json({ detail: "Failed to unlink vehicle" });
  }
});

// ─── GET /workers/:id/access-rules ────────────────────────────────────────────

workersRouter.get("/:id/access-rules", async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(accessRulesTable)
      .where(eq(accessRulesTable.worker_id, req.params.id));

    res.json(rules);
  } catch (err) {
    console.error("[workers] GET /:id/access-rules", err);
    res.status(500).json({ detail: "Failed to fetch access rules" });
  }
});
