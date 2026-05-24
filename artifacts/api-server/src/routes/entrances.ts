import { Router } from "express";
import { db } from "@workspace/db";
import {
  entrancesTable,
  camerasTable,
  intercomsTable,
  villasTable,
  villaEntrancesTable,
} from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

// ─── Helper: enrich entrance with derived villa_ids[] + counts ───────────────
//
// villa_ids[] is the M:N source of truth as of Phase A.2. The legacy
// scalar villa_id column is still returned (back-compat) but is the
// FIRST of villa_ids if any, else null — clients reading villa_id alone
// keep working for single-villa entrances; multi-villa configurations
// expose the full list through villa_ids[].

async function fetchVillaIds(entranceId: string): Promise<string[]> {
  // ORDER BY villa_id keeps the array stable across reads so the legacy
  // scalar villa_id mirror (= villa_ids[0]) is deterministic and does not
  // flap between requests when an entrance is wired to multiple villas.
  const rows = await db
    .select({ villa_id: villaEntrancesTable.villa_id })
    .from(villaEntrancesTable)
    .where(eq(villaEntrancesTable.entrance_id, entranceId))
    .orderBy(villaEntrancesTable.villa_id);
  return rows.map((r) => r.villa_id);
}

async function enrichEntrance(e: typeof entrancesTable.$inferSelect) {
  const [{ cameras }] = await db
    .select({ cameras: sql<number>`count(*)::int` })
    .from(camerasTable)
    .where(eq(camerasTable.entrance_id, e.id));

  const [{ intercoms }] = await db
    .select({ intercoms: sql<number>`count(*)::int` })
    .from(intercomsTable)
    .where(eq(intercomsTable.entrance_id, e.id));

  const villa_ids = await fetchVillaIds(e.id);

  return {
    ...e,
    villa_ids,
    // Back-compat: legacy clients reading scalar villa_id see the first
    // wired villa (or the legacy column value if no rows exist yet).
    villa_id: villa_ids[0] ?? e.villa_id ?? null,
    camera_count: cameras,
    intercom_count: intercoms,
  };
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
  const enriched = await enrichEntrance(rows[0]);

  res.json({ ...enriched, cameras, intercoms });
});

// ─── Body schema ──────────────────────────────────────────────────────────────
//
// Accepts BOTH legacy `villa_id` (scalar, optional/nullable) AND new
// `villa_ids[]` (array of villa ids). Normalised to villa_ids[] by
// resolveVillaIds() below:
//   * villa_ids present → use as-is (deduped)
//   * villa_id present  → treated as [villa_id] if non-null, else []
//   * neither           → []  (entrance becomes dormant / no ANPR/PIN routing)

const upsertSchema = z.object({
  name:        z.string().min(1),
  villa_id:    z.string().optional().nullable(),
  villa_ids:   z.array(z.string()).optional(),
  description: z.string().optional().nullable(),
  active:      z.boolean().optional(),
});

function resolveVillaIds(body: z.infer<typeof upsertSchema>): string[] {
  if (Array.isArray(body.villa_ids)) {
    return Array.from(new Set(body.villa_ids));
  }
  if (body.villa_id) return [body.villa_id];
  return [];
}

async function validateVillaIds(villaIds: string[]): Promise<boolean> {
  if (villaIds.length === 0) return true;
  const rows = await db
    .select({ id: villasTable.id })
    .from(villasTable)
    .where(inArray(villasTable.id, villaIds));
  return rows.length === villaIds.length;
}

// Re-sync villa_entrances rows for one entrance to exactly the given set
// (delete-then-insert). Idempotent. Empty array clears all. Caller MUST
// pass a tx — parent entrance write + this sync are wrapped in a single
// outer transaction so concurrent PUTs cannot interleave and leave the
// legacy scalar villa_id out of sync with the join rows.
async function syncVillaEntrances(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  entranceId: string,
  villaIds: string[],
) {
  await tx
    .delete(villaEntrancesTable)
    .where(eq(villaEntrancesTable.entrance_id, entranceId));
  if (villaIds.length > 0) {
    await tx.insert(villaEntrancesTable).values(
      villaIds.map((villa_id) => ({ villa_id, entrance_id: entranceId })),
    );
  }
}

// ─── POST /entrances ──────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req, res) => {
  const body = upsertSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  const villaIds = resolveVillaIds(body.data);
  if (!(await validateVillaIds(villaIds))) {
    res.status(400).json({ detail: "One or more villas not found" }); return;
  }

  // entrances.villa_id legacy column: keep mirroring the FIRST villa for
  // back-compat with any code/queries that still read it directly. Multi-villa
  // setups are fully expressed in villa_entrances. Sorted villaIds give a
  // deterministic mirror across calls.
  const sortedVillaIds = [...villaIds].sort();
  const legacyVillaId = sortedVillaIds[0] ?? null;

  // Single transaction: parent insert + join sync are atomic. Eliminates
  // the race window where two concurrent POSTs could interleave a parent
  // write of A with a join sync of B.
  const e = await db.transaction(async (tx) => {
    const [row] = await tx.insert(entrancesTable).values({
      name:        body.data.name,
      villa_id:    legacyVillaId,
      description: body.data.description ?? null,
      active:      body.data.active ?? true,
    }).returning();
    await syncVillaEntrances(tx, row.id, sortedVillaIds);
    return row;
  });

  res.status(201).json(await enrichEntrance(e));
});

// ─── PUT /entrances/:id ───────────────────────────────────────────────────────

router.put("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(entrancesTable).where(eq(entrancesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }

  const body = upsertSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  const villaIds = resolveVillaIds(body.data);
  if (!(await validateVillaIds(villaIds))) {
    res.status(400).json({ detail: "One or more villas not found" }); return;
  }

  const sortedVillaIds = [...villaIds].sort();
  const legacyVillaId = sortedVillaIds[0] ?? null;

  // Single transaction: parent update + join sync are atomic. Two
  // concurrent PUTs are serialised at the row level — the surviving
  // final state is one request's full intent, never a mixed merge.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(entrancesTable).set({
      name:        body.data.name,
      villa_id:    legacyVillaId,
      description: body.data.description ?? null,
      active:      body.data.active ?? rows[0].active,
      updated_at:  new Date(),
    }).where(eq(entrancesTable.id, req.params.id)).returning();
    await syncVillaEntrances(tx, row.id, sortedVillaIds);
    return row;
  });

  res.json(await enrichEntrance(updated));
});

// ─── DELETE /entrances/:id ────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(entrancesTable).where(eq(entrancesTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Entrance not found" }); return; }
  // villa_entrances has ON DELETE CASCADE → no manual cleanup needed.
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
