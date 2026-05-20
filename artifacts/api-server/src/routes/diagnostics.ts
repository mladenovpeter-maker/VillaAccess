import { Router } from "express";
import { db } from "@workspace/db";
import { camerasTable, entrancesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { createAdapter } from "../lib/cameras/factory";
import * as net from "net";

const router = Router();

// ─── TCP ping helper ──────────────────────────────────────────────────────────

function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<{ reachable: boolean; latency_ms: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);

    sock.on("connect", () => {
      const latency_ms = Date.now() - start;
      sock.destroy();
      resolve({ reachable: true, latency_ms });
    });

    const fail = () => {
      sock.destroy();
      resolve({ reachable: false, latency_ms: null });
    };

    sock.on("timeout", fail);
    sock.on("error", fail);
    sock.connect(port, host);
  });
}

// ─── RTSP availability check (TCP on port 554) ────────────────────────────────

async function checkRtsp(host: string): Promise<{ available: boolean; latency_ms: number | null }> {
  const result = await tcpPing(host, 554, 3000);
  return { available: result.reachable, latency_ms: result.latency_ms };
}

// ─── POST /diagnostics/camera/:id — full diagnostic run ──────────────────────

router.post("/camera/:id", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(camerasTable)
    .where(eq(camerasTable.id, req.params.id))
    .limit(1);

  const camera = rows[0];
  if (!camera) { res.status(404).json({ detail: "Camera not found" }); return; }

  const started_at = new Date().toISOString();
  const results: Record<string, unknown> = { camera_id: camera.id, camera_name: camera.name, started_at };

  // 1. TCP ping (HTTP port)
  const pingResult = await tcpPing(camera.ip_address, camera.http_port ?? 80, 3000);
  results.ping = { ...pingResult, host: camera.ip_address, port: camera.http_port ?? 80 };

  // 2. RTSP check
  const rtspResult = await checkRtsp(camera.ip_address);
  results.rtsp = { ...rtspResult, host: camera.ip_address, port: 554 };

  // 3. ISAPI / protocol auth + device info
  let apiResult: Record<string, unknown> = { success: false };
  try {
    const adapter = createAdapter(camera);
    const status = await adapter.get_status();
    apiResult = {
      success: status.online,
      latency_ms: status.latency_ms ?? null,
      device_info: status.device_info ?? null,
      error: status.error ?? null,
      protocol: camera.protocol,
    };

    if (status.online) {
      await db
        .update(camerasTable)
        .set({
          status: "online",
          last_status_check: new Date(status.checked_at),
          last_status_latency_ms: status.latency_ms ?? null,
          device_info: status.device_info ? JSON.stringify(status.device_info) : camera.device_info,
          ...(status.device_info?.model ? { model: status.device_info.model } : {}),
          updated_at: new Date(),
        })
        .where(eq(camerasTable.id, camera.id));
    } else {
      await db
        .update(camerasTable)
        .set({ status: "offline", last_status_check: new Date(status.checked_at), updated_at: new Date() })
        .where(eq(camerasTable.id, camera.id));
    }
  } catch (err: any) {
    apiResult = { success: false, error: err.message, protocol: camera.protocol };
    await db
      .update(camerasTable)
      .set({ status: "error", updated_at: new Date() })
      .where(eq(camerasTable.id, camera.id));
  }
  results.api = apiResult;

  // 4. Snapshot test
  let snapshotResult: Record<string, unknown> = { success: false };
  try {
    const adapter = createAdapter(camera);
    const snap = await adapter.get_snapshot();
    snapshotResult = {
      success: snap.success,
      snapshot_url: snap.snapshot_url ?? null,
      error: snap.error ?? null,
      file_size_bytes: snap.file_size_bytes ?? null,
      mime_type: snap.mime_type ?? null,
      latency_ms: snap.latency_ms ?? null,
    };
    if (snap.success && snap.snapshot_url) {
      await db
        .update(camerasTable)
        .set({ snapshot_url: snap.snapshot_url, last_snapshot: new Date(snap.captured_at), updated_at: new Date() })
        .where(eq(camerasTable.id, camera.id));
    }
  } catch (err: any) {
    snapshotResult = { success: false, error: err.message };
  }
  results.snapshot = snapshotResult;

  // 5. Overall score
  const checks = [
    pingResult.reachable,
    (apiResult.success as boolean) === true,
    (snapshotResult.success as boolean) === true,
  ];
  const passed = checks.filter(Boolean).length;
  results.overall = {
    passed,
    total: checks.length,
    healthy: passed === checks.length,
    score: Math.round((passed / checks.length) * 100),
  };
  results.completed_at = new Date().toISOString();

  res.json(results);
});

// ─── GET /diagnostics/cameras — batch status for all cameras ─────────────────

router.get("/cameras", requireAuth, async (_req, res) => {
  const cameras = await db
    .select({
      id: camerasTable.id,
      name: camerasTable.name,
      ip_address: camerasTable.ip_address,
      http_port: camerasTable.http_port,
      protocol: camerasTable.protocol,
      status: camerasTable.status,
      last_status_check: camerasTable.last_status_check,
      last_status_latency_ms: camerasTable.last_status_latency_ms,
      entrance_id: camerasTable.entrance_id,
      last_snapshot: camerasTable.last_snapshot,
    })
    .from(camerasTable)
    .orderBy(camerasTable.name);

  res.json(cameras);
});

// ─── GET /diagnostics/system — system component health ───────────────────────

router.get("/system", requireAuth, async (_req, res) => {
  const checked_at = new Date().toISOString();

  // DB health
  let dbStatus: "ok" | "error" = "error";
  let dbLatency = 0;
  try {
    const t0 = Date.now();
    await db.execute("SELECT 1" as any);
    dbLatency = Date.now() - t0;
    dbStatus = "ok";
  } catch { dbStatus = "error"; }


  const allCameras = await db.select({ status: camerasTable.status }).from(camerasTable);
  const cameraOnline  = allCameras.filter((c) => c.status === "online").length;
  const cameraOffline = allCameras.filter((c) => c.status === "offline").length;
  const cameraError   = allCameras.filter((c) => c.status === "error").length;

  // Entrance count
  const entrances = await db.select({ id: entrancesTable.id, status: entrancesTable.status }).from(entrancesTable);

  res.json({
    checked_at,
    components: {
      database:   { status: dbStatus,   latency_ms: dbLatency, detail: "PostgreSQL via Drizzle ORM" },
      api:        { status: "ok",        latency_ms: 0,         detail: "Express API server" },
      event_bus:  { status: "ok",        latency_ms: null,      detail: "In-process SSE event bus" },
      ocr_worker: { status: "not_configured", latency_ms: null, detail: "OCR pipeline — not yet active" },
      ai_engine:  { status: "not_configured", latency_ms: null, detail: "AI recognition — not yet active" },
    },
    cameras: {
      total:   allCameras.length,
      online:  cameraOnline,
      offline: cameraOffline,
      error:   cameraError,
    },
    entrances: {
      total:  entrances.length,
      active: entrances.filter((e) => e.status === "active").length,
    },
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

export { router as diagnosticsRouter };
