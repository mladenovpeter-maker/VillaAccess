import { Router } from "express";
import { db } from "@workspace/db";
import { intercomsTable, entrancesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { eventBus } from "../lib/events";

const router = Router();

function serializeIntercom(i: typeof intercomsTable.$inferSelect) {
  return {
    id: i.id,
    name: i.name,
    entrance_id: i.entrance_id,
    ip_address: i.ip_address,
    http_port: i.http_port,
    username: i.username,
    protocol: i.protocol,
    device_type: i.device_type,
    relay_no: i.relay_no,
    door_count: i.door_count ?? 1,
    lock_type: i.lock_type ?? null,
    pin_support: i.pin_support ?? true,
    schedule_support: i.schedule_support ?? false,
    pin_sync_enabled: i.pin_sync_enabled,
    last_sync_status: i.last_sync_status,
    last_sync_at: i.last_sync_at,
    status: i.status,
    last_status_check: i.last_status_check,
    last_status_latency_ms: i.last_status_latency_ms,
    device_info: i.device_info ? (() => {
      try { return JSON.parse(i.device_info!); } catch { return null; }
    })() : null,
    notes: i.notes,
    created_at: i.created_at,
    updated_at: i.updated_at,
  };
}

// ─── GET /intercoms ───────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(intercomsTable).orderBy(intercomsTable.name);
  res.json(rows.map(serializeIntercom));
});

// ─── GET /intercoms/:id ───────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Intercom not found" }); return; }
  res.json(serializeIntercom(rows[0]));
});

// ─── POST /intercoms ──────────────────────────────────────────────────────────

const createSchema = z.object({
  name:             z.string().min(1),
  entrance_id:      z.string().optional().nullable(),
  ip_address:       z.string().min(1),
  http_port:        z.number().int().optional(),
  username:         z.string().optional(),
  password:         z.string().optional(),
  protocol:         z.enum(["hikvision", "dahua", "sip", "generic"]).optional(),
  device_type:      z.string().optional().nullable(),
  relay_no:         z.number().int().optional(),
  door_count:       z.number().int().optional().nullable(),
  lock_type:        z.string().optional().nullable(),
  pin_support:      z.boolean().optional(),
  schedule_support: z.boolean().optional(),
  pin_sync_enabled: z.boolean().optional(),
  notes:            z.string().optional().nullable(),
});

router.post("/", requireAuth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }

  if (body.data.entrance_id) {
    const ent = await db.select({ id: entrancesTable.id }).from(entrancesTable)
      .where(eq(entrancesTable.id, body.data.entrance_id)).limit(1);
    if (!ent[0]) { res.status(400).json({ detail: "Entrance not found" }); return; }
  }

  const [i] = await db.insert(intercomsTable).values({
    name:             body.data.name,
    entrance_id:      body.data.entrance_id ?? null,
    ip_address:       body.data.ip_address,
    http_port:        body.data.http_port ?? 80,
    username:         body.data.username ?? "admin",
    password:         body.data.password ?? null,
    protocol:         body.data.protocol ?? "hikvision",
    device_type:      body.data.device_type ?? null,
    relay_no:         body.data.relay_no ?? 1,
    door_count:       body.data.door_count ?? 1,
    lock_type:        body.data.lock_type ?? null,
    pin_support:      body.data.pin_support ?? true,
    schedule_support: body.data.schedule_support ?? false,
    pin_sync_enabled: body.data.pin_sync_enabled ?? true,
    notes:            body.data.notes ?? null,
  }).returning();

  res.status(201).json(serializeIntercom(i));
});

// ─── PATCH /intercoms/:id ─────────────────────────────────────────────────────

router.patch("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Intercom not found" }); return; }

  const allowed = [
    "name", "entrance_id", "ip_address", "http_port", "username", "password",
    "protocol", "device_type", "relay_no", "door_count", "lock_type",
    "pin_support", "schedule_support", "pin_sync_enabled", "notes",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date() };
  for (const key of allowed) {
    if (key in req.body) patch[key] = req.body[key];
  }

  const [updated] = await db.update(intercomsTable).set(patch as any)
    .where(eq(intercomsTable.id, req.params.id)).returning();

  res.json(serializeIntercom(updated));
});

// ─── DELETE /intercoms/:id ────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Intercom not found" }); return; }
  await db.delete(intercomsTable).where(eq(intercomsTable.id, req.params.id));
  res.status(204).send();
});

// ─── POST /intercoms/:id/open ─────────────────────────────────────────────────

router.post("/:id/open", requireAuth, async (req: any, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Door controller not found" }); return; }
  const ic = rows[0];

  const operator = req.user?.username ?? req.user?.email ?? "unknown";

  console.log(`[access-control.open] ▶ OPEN user=${operator} device="${ic.name}" (${ic.id}) door=${ic.relay_no}`);

  const { HikvisionIntercomService } = await import("../services/hikvision/intercom");
  const svc = new HikvisionIntercomService({
    id:         ic.id,
    name:       ic.name,
    ip_address: ic.ip_address,
    http_port:  ic.http_port,
    username:   ic.username,
    password:   ic.password ?? "",
    relay_no:   ic.relay_no,
  });

  const result = await svc.openDoor();

  console.log(
    `[access-control.open] ◀ CLOSE user=${operator} device="${ic.name}" ` +
    `success=${result.success} elapsed=${result.elapsed_ms}ms` +
    (result.error ? ` error=${result.error}` : ""),
  );

  // Audit event — "User X opened door via Device Y"
  void eventBus.publish({
    event_type: result.success ? "gate.door_opened" : "gate.door_failed",
    severity:   result.success ? "info" : "error",
    operator_id: req.user?.id,
    source:      "dashboard",
    payload: {
      intercom_id:   ic.id,
      intercom_name: ic.name,
      entrance_id:   ic.entrance_id,
      door_no:       ic.relay_no,
      operator,
      operator_id:   req.user?.id,
      method:        "manual_pulse",
      pulse_ms:      3000,
      elapsed_ms:    result.elapsed_ms,
      success:       result.success,
      error:         result.error,
      message: `${operator} ${result.success ? "opened" : "tried to open"} door via "${ic.name}"`,
    },
  });

  // 200 = open command succeeded (door released).
  // 502 = open command itself failed — close failure is a non-fatal warning.
  res.status(result.success ? 200 : 502).json({
    intercom_id:    ic.id,
    intercom_name:  ic.name,
    action:         "open_door",
    door_no:        ic.relay_no,
    pulse_ms:       3000,
    elapsed_ms:     result.elapsed_ms,
    triggered_by:   operator,
    success:        result.success,
    error:          result.error          ?? null,
    close_warning:  result.close_warning  ?? null,
    raw_status:     result.raw_status     ?? null,
    upstream_body:  result.upstream_body  ?? null,
  });
});

// ─── POST /intercoms/:id/test-connectivity ────────────────────────────────────

router.post("/:id/test-connectivity", requireAuth, async (req, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Intercom not found" }); return; }
  const ic = rows[0];

  const { HikvisionIntercomService } = await import("../services/hikvision/intercom");
  const svc = new HikvisionIntercomService({
    id:         ic.id,
    name:       ic.name,
    ip_address: ic.ip_address,
    http_port:  ic.http_port,
    username:   ic.username,
    password:   ic.password ?? "",
    relay_no:   ic.relay_no,
  });

  const start = Date.now();
  const result = await svc.testConnectivity();
  const latency_ms = Date.now() - start;

  const now = new Date();
  const newStatus = result.success ? "online" : "offline";
  await db.update(intercomsTable)
    .set({ status: newStatus as any, last_status_check: now, last_status_latency_ms: latency_ms, updated_at: now })
    .where(eq(intercomsTable.id, ic.id));

  res.json({
    intercom_id:   ic.id,
    intercom_name: ic.name,
    success:       result.success,
    latency_ms,
    device_name:   result.device_name,
    serial:        result.serial,
    error:         result.error,
  });
});

// ─── POST /intercoms/:id/test-pin-sync ───────────────────────────────────────

router.post("/:id/test-pin-sync", requireAuth, async (req, res) => {
  const rows = await db.select().from(intercomsTable).where(eq(intercomsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Intercom not found" }); return; }
  const ic = rows[0];

  if (ic.protocol !== "hikvision") {
    res.status(400).json({ detail: "PIN sync test is only supported for Hikvision devices" });
    return;
  }

  const { HikvisionIntercomService } = await import("../services/hikvision/intercom");
  const svc = new HikvisionIntercomService({
    id:         ic.id,
    name:       ic.name,
    ip_address: ic.ip_address,
    http_port:  ic.http_port,
    username:   ic.username,
    password:   ic.password ?? "",
    relay_no:   ic.relay_no,
  });

  const result = await svc.testPinSync();

  const now = new Date();
  await db.update(intercomsTable)
    .set({ last_sync_status: result.success ? "success" : "failed", last_sync_at: now, updated_at: now })
    .where(eq(intercomsTable.id, ic.id));

  res.json({
    intercom_id:   ic.id,
    intercom_name: ic.name,
    success:       result.success,
    latency_ms:    result.latency_ms,
    error:         result.error,
  });
});

export { router as intercomsRouter };
