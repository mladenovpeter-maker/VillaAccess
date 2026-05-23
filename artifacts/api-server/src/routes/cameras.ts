import { Router } from "express";
import { db } from "@workspace/db";
import { camerasTable, entrancesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireWriteAccess } from "./auth";
import { createAdapter } from "../lib/cameras/factory";
import { eventBus } from "../lib/events";

const router = Router();

// ─── Serialise — password is never returned ───────────────────────────────────

function serializeCamera(c: typeof camerasTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    ip_address: c.ip_address,
    rtsp_url: c.rtsp_url,
    entrance_id: c.entrance_id,
    model: c.model,
    protocol: c.protocol,
    http_port: c.http_port,
    username: c.username,
    channel_no: c.channel_no,
    gate_no: c.gate_no,
    status: c.status,
    last_snapshot: c.last_snapshot,
    snapshot_url: c.snapshot_url,
    last_status_check: c.last_status_check,
    last_status_latency_ms: c.last_status_latency_ms,
    device_info: c.device_info ? (() => {
      try { return JSON.parse(c.device_info!); } catch { return null; }
    })() : null,
    ocr_enabled: c.ocr_enabled,
    polling_interval_ms: c.polling_interval_ms,
    ocr_min_confidence: c.ocr_min_confidence,
    anpr_cooldown_seconds: c.anpr_cooldown_seconds,
    last_anpr_plate: c.last_anpr_plate,
    last_anpr_at: c.last_anpr_at,
    // Fuzzy / partial plate matching (additive)
    allow_partial_match: c.allow_partial_match,
    partial_match_threshold: c.partial_match_threshold,
    partial_min_confidence: c.partial_min_confidence,
    min_matching_digits: c.min_matching_digits,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

async function loadCamera(id: string) {
  const rows = await db.select().from(camerasTable).where(eq(camerasTable.id, id)).limit(1);
  return rows[0] ?? null;
}

// ─── GET /cameras ─────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const cameras = await db.select().from(camerasTable).orderBy(camerasTable.name);
  res.json(cameras.map(serializeCamera));
});

// ─── GET /cameras/:id ─────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }
  res.json(serializeCamera(c));
});

// ─── POST /cameras ────────────────────────────────────────────────────────────

router.post("/", requireAuth, requireWriteAccess(), async (req, res) => {
  const t0 = Date.now();
  console.log("[cameras.create] 1/6 route entered", { ip: req.body?.ip_address, name: req.body?.name });
  try {
    const {
      name, ip_address, rtsp_url, entrance_id, model,
      protocol, http_port, username, password,
      channel_no, gate_no,
      ocr_enabled, polling_interval_ms, ocr_min_confidence,
      anpr_cooldown_seconds,
      allow_partial_match, partial_match_threshold,
      partial_min_confidence, min_matching_digits,
    } = req.body;

    if (!name || !ip_address) {
      console.log("[cameras.create] validation failed: missing name/ip_address");
      res.status(400).json({ detail: "name and ip_address are required" });
      return;
    }
    console.log("[cameras.create] 2/6 validation ok");

    if (entrance_id) {
      console.log("[cameras.create] 3/6 entrance lookup start", { entrance_id });
      const ent = await db.select({ id: entrancesTable.id }).from(entrancesTable)
        .where(eq(entrancesTable.id, entrance_id)).limit(1);
      console.log("[cameras.create] 3/6 entrance lookup done", { found: !!ent[0] });
      if (!ent[0]) { res.status(400).json({ detail: "Entrance not found" }); return; }
    } else {
      console.log("[cameras.create] 3/6 entrance lookup skipped (no entrance_id)");
    }

    console.log("[cameras.create] 4/6 insert start");
    const [c] = await db
      .insert(camerasTable)
      .values({
        name,
        ip_address,
        rtsp_url: rtsp_url ?? null,
        entrance_id: entrance_id ?? null,
        model: model ?? null,
        protocol: protocol ?? "hikvision",
        http_port: http_port ?? 80,
        username: username ?? "admin",
        password: password ?? null,
        channel_no: channel_no ?? 1,
        gate_no: gate_no ?? 1,
        // ANPR — accept on create so the UI can configure these up-front
        // instead of always requiring a follow-up PATCH.
        ...(ocr_enabled !== undefined ? { ocr_enabled: Boolean(ocr_enabled) } : {}),
        ...(polling_interval_ms !== undefined
          ? { polling_interval_ms: Math.max(500, Math.min(60000, Number(polling_interval_ms) || 1500)) }
          : {}),
        ...(ocr_min_confidence !== undefined
          ? { ocr_min_confidence: Math.max(0, Math.min(100, Number(ocr_min_confidence) || 70)) }
          : {}),
        ...(anpr_cooldown_seconds !== undefined
          ? { anpr_cooldown_seconds: Math.max(1, Math.min(3600, Number(anpr_cooldown_seconds) || 30)) }
          : {}),
        ...(allow_partial_match !== undefined ? { allow_partial_match: Boolean(allow_partial_match) } : {}),
        ...(partial_match_threshold !== undefined
          ? { partial_match_threshold: Math.max(0, Math.min(100, Number(partial_match_threshold) || 85)) }
          : {}),
        ...(partial_min_confidence !== undefined
          ? { partial_min_confidence: Math.max(0, Math.min(100, Number(partial_min_confidence) || 50)) }
          : {}),
        ...(min_matching_digits !== undefined
          ? { min_matching_digits: Math.max(0, Math.min(20, Number(min_matching_digits) || 4)) }
          : {}),
      })
      .returning();
    console.log("[cameras.create] 4/6 insert done", { id: c?.id });

    console.log("[cameras.create] 5/6 serialize start");
    const payload = serializeCamera(c);
    console.log("[cameras.create] 5/6 serialize done");

    res.status(201).json(payload);
    console.log("[cameras.create] 6/6 response sent", { ms: Date.now() - t0 });
  } catch (err) {
    console.error("[cameras.create] ERROR", { ms: Date.now() - t0, err });
    if (!res.headersSent) res.status(500).json({ detail: "Internal server error" });
  }
});

// ─── PATCH /cameras/:id ───────────────────────────────────────────────────────

router.patch("/:id", requireAuth, requireWriteAccess(), async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const allowed = [
    "name", "ip_address", "rtsp_url", "entrance_id", "model",
    "protocol", "http_port", "username", "password",
    "channel_no", "gate_no",
    "ocr_enabled", "polling_interval_ms", "ocr_min_confidence",
    "anpr_cooldown_seconds",
    // Fuzzy / partial plate matching (additive)
    "allow_partial_match", "partial_match_threshold",
    "partial_min_confidence", "min_matching_digits",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date() };
  for (const key of allowed) {
    if (key in req.body) patch[key] = req.body[key];
  }

  // Server-side bounds for ANPR config (UI clamps too, but never trust client).
  if ("polling_interval_ms" in patch) {
    const v = Number(patch["polling_interval_ms"]);
    patch["polling_interval_ms"] = Number.isFinite(v) ? Math.max(500, Math.min(60000, Math.round(v))) : 1500;
  }
  if ("ocr_min_confidence" in patch) {
    const v = Number(patch["ocr_min_confidence"]);
    patch["ocr_min_confidence"] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 70;
  }
  if ("anpr_cooldown_seconds" in patch) {
    const v = Number(patch["anpr_cooldown_seconds"]);
    patch["anpr_cooldown_seconds"] = Number.isFinite(v) ? Math.max(1, Math.min(3600, Math.round(v))) : 30;
  }
  if ("ocr_enabled" in patch) {
    patch["ocr_enabled"] = Boolean(patch["ocr_enabled"]);
  }
  if ("allow_partial_match" in patch) {
    patch["allow_partial_match"] = Boolean(patch["allow_partial_match"]);
  }
  if ("partial_match_threshold" in patch) {
    const v = Number(patch["partial_match_threshold"]);
    patch["partial_match_threshold"] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 85;
  }
  if ("partial_min_confidence" in patch) {
    const v = Number(patch["partial_min_confidence"]);
    patch["partial_min_confidence"] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
  }
  if ("min_matching_digits" in patch) {
    const v = Number(patch["min_matching_digits"]);
    patch["min_matching_digits"] = Number.isFinite(v) ? Math.max(0, Math.min(20, Math.round(v))) : 4;
  }

  const [updated] = await db
    .update(camerasTable)
    .set(patch as any)
    .where(eq(camerasTable.id, req.params.id))
    .returning();

  res.json(serializeCamera(updated));
});

// ─── DELETE /cameras/:id ──────────────────────────────────────────────────────

router.delete("/:id", requireAuth, requireWriteAccess(), async (req, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }
  await db.delete(camerasTable).where(eq(camerasTable.id, req.params.id));
  res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
// Live camera action endpoints — delegate to the camera adapter layer
// Cameras handle: snapshot, status, and an on-board I/O relay (gate).
// Door release / PIN access lives on the Intercoms endpoints.
// ─────────────────────────────────────────────────────────────────────────────

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

  if (result.success && result.snapshot_url) {
    void eventBus.publish({
      event_type: "ai.snapshot_uploaded",
      camera_id: c.id,
      source: "camera",
      payload: { snapshot_url: result.snapshot_url, mime_type: result.mime_type, file_size_bytes: result.file_size_bytes },
    });
  }

  res.json({ camera_id: c.id, camera_name: c.name, ...result });
});

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
      device_info: result.device_info ? JSON.stringify(result.device_info) : c.device_info,
      ...(result.device_info?.model ? { model: result.device_info.model } : {}),
      updated_at: new Date(),
    })
    .where(eq(camerasTable.id, c.id));

  res.json({ camera_id: c.id, camera_name: c.name, ...result });
});

router.post("/:id/gate", requireAuth, async (req: any, res) => {
  const c = await loadCamera(req.params.id);
  if (!c) { res.status(404).json({ detail: "Camera not found" }); return; }

  const operator = req.user?.username ?? req.user?.email ?? "unknown";
  const t0 = Date.now();

  console.log(`[cameras.gate] ▶ ON  user=${operator} camera="${c.name}" (${c.id}) relay=${c.gate_no}`);

  const adapter = createAdapter(c);
  const result = await adapter.open_gate();
  const elapsed_ms = Date.now() - t0;

  console.log(
    `[cameras.gate] ◀ OFF user=${operator} camera="${c.name}" ` +
    `success=${result.success} elapsed=${elapsed_ms}ms` +
    (result.error ? ` error=${result.error}` : ""),
  );

  // Audit event — "User X opened gate via Camera Y"
  void eventBus.publish({
    event_type: result.success ? "gate.opened" : "gate.failed",
    severity: result.success ? "info" : "error",
    camera_id: c.id,
    operator_id: req.user?.id,
    source: "dashboard",
    payload: {
      ...result,
      camera_name: c.name,
      entrance_id: c.entrance_id,
      operator,
      operator_id: req.user?.id,
      method: "manual_pulse",
      pulse_ms: 3000,
      elapsed_ms,
      message: `${operator} ${result.success ? "opened" : "tried to open"} gate via camera "${c.name}"`,
    },
  });

  res.json({
    camera_id: c.id,
    camera_name: c.name,
    triggered_by: operator,
    pulse_ms: 3000,
    elapsed_ms,
    ...result,
  });
});

export { router as camerasRouter };
