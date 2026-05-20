import { Router } from "express";
import { db } from "@workspace/db";
import { camerasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { createAdapter } from "../lib/cameras/factory";

const router = Router();

// ─── Serialise — password is never returned ───────────────────────────────────

function serializeCamera(c: typeof camerasTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    ip_address: c.ip_address,
    rtsp_url: c.rtsp_url,
    villa_id: c.villa_id,
    model: c.model,
    protocol: c.protocol,
    http_port: c.http_port,
    username: c.username,
    channel_no: c.channel_no,
    use_access_control: c.use_access_control,
    gate_no: c.gate_no,
    door_no: c.door_no,
    status: c.status,
    last_snapshot: c.last_snapshot,
    snapshot_url: c.snapshot_url,
    last_status_check: c.last_status_check,
    last_status_latency_ms: c.last_status_latency_ms,
    device_info: c.device_info ? (() => {
      try { return JSON.parse(c.device_info!); } catch { return null; }
    })() : null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

async function loadCamera(id: string) {
  const rows = await db
    .select()
    .from(camerasTable)
    .where(eq(camerasTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ─── GET /cameras ─────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const cameras = await db
    .select()
    .from(camerasTable)
    .orderBy(camerasTable.name);
  res.json(cameras.map(serializeCamera));
});

// ─── GET /cameras/:id ─────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }
  res.json(serializeCamera(c));
});

// ─── POST /cameras ────────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req, res) => {
  const {
    name, ip_address, rtsp_url, villa_id, model,
    protocol, http_port, username, password,
    channel_no, use_access_control, gate_no, door_no,
  } = req.body;

  if (!name || !ip_address) {
    res.status(400).json({ detail: "name and ip_address are required" });
    return;
  }

  const [c] = await db
    .insert(camerasTable)
    .values({
      name,
      ip_address,
      rtsp_url: rtsp_url ?? null,
      villa_id: villa_id ?? null,
      model: model ?? null,
      protocol: protocol ?? "hikvision",
      http_port: http_port ?? 80,
      username: username ?? "admin",
      password: password ?? null,
      channel_no: channel_no ?? 1,
      use_access_control: use_access_control ?? false,
      gate_no: gate_no ?? 1,
      door_no: door_no ?? 2,
    })
    .returning();

  res.status(201).json(serializeCamera(c));
});

// ─── PATCH /cameras/:id ───────────────────────────────────────────────────────

router.patch("/:id", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const allowed = [
    "name", "ip_address", "rtsp_url", "villa_id", "model",
    "protocol", "http_port", "username", "password",
    "channel_no", "use_access_control", "gate_no", "door_no",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date() };
  for (const key of allowed) {
    if (key in req.body) patch[key] = req.body[key];
  }

  const [updated] = await db
    .update(camerasTable)
    .set(patch as any)
    .where(eq(camerasTable.id, req.params.id))
    .returning();

  res.json(serializeCamera(updated));
});

// ─── DELETE /cameras/:id ──────────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }
  await db.delete(camerasTable).where(eq(camerasTable.id, req.params.id));
  res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
// Live camera action endpoints — delegate to the camera adapter layer
// ─────────────────────────────────────────────────────────────────────────────

// GET /cameras/:id/snapshot
// Fetches a live JPEG from the physical camera via ISAPI, stores it locally,
// and updates snapshot_url + last_snapshot in the DB.

router.get("/:id/snapshot", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const adapter = createAdapter(c);
  const result = await adapter.get_snapshot();

  if (result.success && result.snapshot_url) {
    await db
      .update(camerasTable)
      .set({
        snapshot_url: result.snapshot_url,
        last_snapshot: result.captured_at,
        status: "online",
        updated_at: new Date(),
      })
      .where(eq(camerasTable.id, c.id));
  } else if (c.status === "online") {
    await db
      .update(camerasTable)
      .set({ status: "error", updated_at: new Date() })
      .where(eq(camerasTable.id, c.id));
  }

  res.json({ camera_id: c.id, camera_name: c.name, ...result });
});

// GET /cameras/:id/status
// Pings the camera, retrieves device info, updates DB status + latency.

router.get("/:id/status", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const adapter = createAdapter(c);
  const result = await adapter.get_status();

  await db
    .update(camerasTable)
    .set({
      status: result.online ? "online" : "offline",
      last_status_check: result.checked_at,
      last_status_latency_ms: result.latency_ms ?? null,
      device_info: result.device_info
        ? JSON.stringify(result.device_info)
        : c.device_info,
      ...(result.device_info?.model ? { model: result.device_info.model } : {}),
      updated_at: new Date(),
    })
    .where(eq(camerasTable.id, c.id));

  res.json({ camera_id: c.id, camera_name: c.name, ...result });
});

// POST /cameras/:id/gate
// Triggers the gate relay (I/O output) or AccessControl gate door.

router.post("/:id/gate", requireAuth, async (req: any, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const adapter = createAdapter(c);
  const result = await adapter.open_gate();

  res.json({
    camera_id: c.id,
    camera_name: c.name,
    triggered_by: req.user?.username ?? "unknown",
    ...result,
  });
});

// POST /cameras/:id/door
// Triggers the door relay (I/O output) or AccessControl side door.

router.post("/:id/door", requireAuth, async (req: any, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const adapter = createAdapter(c);
  const result = await adapter.open_door();

  res.json({
    camera_id: c.id,
    camera_name: c.name,
    triggered_by: req.user?.username ?? "unknown",
    ...result,
  });
});

export { router as camerasRouter };
