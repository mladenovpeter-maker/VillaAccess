/**
 * ACS (Access Control System) routes — Hikvision ASC3202B card sync.
 *
 * POST /acs/sync                 → sync all active access rules to all linked controllers
 * POST /acs/sync/:entranceId     → sync one entrance only
 * POST /acs/anti-passback        → enable/disable anti-passback on entrance controller
 * GET  /acs/status               → last sync status per controller
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { intercomsTable, workersTable, accessRulesTable, shiftsTable, entrancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { HikvisionACSService, hikEmployeeNo } from "../services/hikvision/acs";

export const acsRouter = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getACSIntercomsForEntrance(entranceId?: string) {
  const rows = entranceId
    ? await db.select().from(intercomsTable).where(
        and(eq(intercomsTable.entrance_id, entranceId), eq(intercomsTable.protocol, "hikvision"))
      )
    : await db.select().from(intercomsTable).where(eq(intercomsTable.protocol, "hikvision"));

  // Only devices that have schedule_support=true are ASC controllers (not intercoms/door-stations)
  return rows.filter((r) => r.schedule_support === true);
}

function makeACSService(ic: typeof intercomsTable.$inferSelect) {
  return new HikvisionACSService({
    id: ic.id,
    name: ic.name,
    ip_address: ic.ip_address,
    http_port: ic.http_port,
    username: ic.username,
    password: ic.password ?? "",
    relay_no: ic.relay_no,
  });
}

// ─── GET /acs/status ─────────────────────────────────────────────────────────

acsRouter.get("/status", async (_req, res) => {
  try {
    const devices = await getACSIntercomsForEntrance();
    const entrances = await db.select().from(entrancesTable);
    const entranceMap = new Map(entrances.map((e) => [e.id, e.name]));

    const status = devices.map((d) => ({
      id: d.id,
      name: d.name,
      entrance_id: d.entrance_id,
      entrance_name: d.entrance_id ? (entranceMap.get(d.entrance_id) ?? null) : null,
      ip_address: d.ip_address,
      last_sync_at: d.last_sync_at,
      last_sync_status: d.last_sync_status,
      status: d.status,
    }));

    res.json(status);
  } catch (err) {
    console.error("[acs] GET /status", err);
    res.status(500).json({ detail: "Failed to get ACS status" });
  }
});

// ─── POST /acs/sync ───────────────────────────────────────────────────────────
// Syncs all active access rules to all ASC3202B controllers.
// Optionally restricted to a single entrance via ?entrance_id=...

acsRouter.post("/sync", async (req, res) => {
  const entranceId = (req.query.entrance_id as string) || undefined;
  await runSync(entranceId, res);
});

acsRouter.post("/sync/:entranceId", async (req, res) => {
  await runSync(req.params.entranceId, res);
});

async function runSync(entranceId: string | undefined, res: any) {
  try {
    const devices = await getACSIntercomsForEntrance(entranceId);
    if (devices.length === 0) {
      return res.status(404).json({ detail: entranceId ? "No ASC controller found for this entrance" : "No ASC controllers configured" });
    }

    // Load all shifts (for time templates)
    const allShifts = await db.select().from(shiftsTable);

    const allResults: any[] = [];

    for (const device of devices) {
      if (!device.entrance_id) continue;

      // Load active access rules for this entrance with worker data
      const rulesWithWorkers = await db
        .select({
          rule_id: accessRulesTable.id,
          shift_id: accessRulesTable.shift_id,
          worker_id: workersTable.id,
          employee_number: workersTable.employee_number,
          first_name: workersTable.first_name,
          last_name: workersTable.last_name,
          badge_no: workersTable.badge_no,
        })
        .from(accessRulesTable)
        .innerJoin(workersTable, eq(accessRulesTable.worker_id, workersTable.id))
        .where(
          and(
            eq(accessRulesTable.entrance_id, device.entrance_id),
            eq(accessRulesTable.active, true),
            eq(workersTable.active, true),
          )
        );

      const svc = makeACSService(device);
      const syncResult = await svc.fullSync(
        rulesWithWorkers.map((r) => ({
          id: r.worker_id,
          employee_number: r.employee_number,
          first_name: r.first_name,
          last_name: r.last_name,
          badge_no: r.badge_no,
          shift_id: r.shift_id,
        })),
        allShifts as any,
      );

      // Persist sync status on the intercom record
      const syncStatus = syncResult.failed.length === 0
        ? `OK — ${syncResult.synced} карти, ${syncResult.skipped} без картa`
        : `Частично — ${syncResult.synced} OK, ${syncResult.failed.length} грешки`;

      await db.update(intercomsTable)
        .set({ last_sync_at: new Date(), last_sync_status: syncStatus })
        .where(eq(intercomsTable.id, device.id));

      allResults.push({ ...syncResult, entrance_id: device.entrance_id, intercom_id: device.id });
    }

    res.json({
      synced_devices: allResults.length,
      results: allResults,
    });
  } catch (err) {
    console.error("[acs] POST /sync", err);
    res.status(500).json({ detail: "Sync failed" });
  }
}

// ─── POST /acs/anti-passback ─────────────────────────────────────────────────

const antiPassbackSchema = z.object({
  entrance_id: z.string(),
  enable: z.boolean(),
  mode: z.enum(["double", "single", "none"]).optional().default("double"),
});

acsRouter.post("/anti-passback", async (req, res) => {
  const parse = antiPassbackSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

  const { entrance_id, enable, mode } = parse.data;

  try {
    const devices = await getACSIntercomsForEntrance(entrance_id);
    if (devices.length === 0) {
      return res.status(404).json({ detail: "No ASC controller found for this entrance" });
    }

    const results: any[] = [];
    for (const device of devices) {
      const svc = makeACSService(device);
      const r = await svc.setAntiPassback(device.relay_no, enable, mode);
      results.push({ intercom_id: device.id, name: device.name, ...r });
    }

    res.json({ results });
  } catch (err) {
    console.error("[acs] POST /anti-passback", err);
    res.status(500).json({ detail: "Anti-passback configuration failed" });
  }
});

// ─── POST /acs/delete-card ───────────────────────────────────────────────────
// Remove a specific worker's card from all (or one entrance's) controllers.

const deleteCardSchema = z.object({
  worker_id: z.string(),
  entrance_id: z.string().optional(),
});

acsRouter.post("/delete-card", async (req, res) => {
  const parse = deleteCardSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ detail: parse.error.issues[0]?.message });

  try {
    const worker = await db.select().from(workersTable).where(eq(workersTable.id, parse.data.worker_id)).then((r) => r[0]);
    if (!worker) return res.status(404).json({ detail: "Worker not found" });

    const empNo = hikEmployeeNo(worker);

    const devices = await getACSIntercomsForEntrance(parse.data.entrance_id);
    const results: any[] = [];
    for (const device of devices) {
      const svc = makeACSService(device);
      const r = await svc.deleteCardUser(empNo);
      results.push({ intercom_id: device.id, name: device.name, ...r });
    }

    res.json({ employee_no: empNo, results });
  } catch (err) {
    console.error("[acs] POST /delete-card", err);
    res.status(500).json({ detail: "Delete card failed" });
  }
});
