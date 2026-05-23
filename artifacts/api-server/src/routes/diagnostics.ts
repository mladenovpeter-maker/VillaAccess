import { Router } from "express";
import { db } from "@workspace/db";
import { camerasTable, entrancesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { createAdapter } from "../lib/cameras/factory";
import * as net from "net";
import * as os from "os";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

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
    };
    if (snap.success && snap.snapshot_url) {
      const capturedAt = snap.captured_at ? new Date(snap.captured_at) : new Date();
      await db
        .update(camerasTable)
        .set({ snapshot_url: snap.snapshot_url, last_snapshot: capturedAt, updated_at: new Date() })
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

// Tier 1.5: prefer /host/proc when bind-mounted, else container's /proc via os.*
async function readHostMem(): Promise<{ total: number; free: number; available: number; source: "host" | "container" }> {
  try {
    const raw = await fsp.readFile("/host/proc/meminfo", "utf8");
    const get = (k: string) => {
      const m = raw.match(new RegExp(`^${k}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? Number(m[1]) * 1024 : NaN;
    };
    const total = get("MemTotal");
    const free = get("MemFree");
    const available = get("MemAvailable");
    if (Number.isFinite(total) && Number.isFinite(available)) {
      return { total, free: Number.isFinite(free) ? free : available, available, source: "host" };
    }
  } catch { /* fall through */ }
  const total = os.totalmem();
  const free = os.freemem();
  return { total, free, available: free, source: "container" };
}

async function readHostCpuCores(): Promise<number | null> {
  try {
    const raw = await fsp.readFile("/host/proc/cpuinfo", "utf8");
    const n = (raw.match(/^processor\s*:/gm) || []).length;
    if (n > 0) return n;
  } catch { /* fall through */ }
  return null;
}

async function readHostLoad(): Promise<{ load: [number, number, number]; cores: number; source: "host" | "container" }> {
  try {
    const raw = await fsp.readFile("/host/proc/loadavg", "utf8");
    const parts = raw.trim().split(/\s+/);
    const l1 = Number(parts[0]), l5 = Number(parts[1]), l15 = Number(parts[2]);
    if ([l1, l5, l15].every(Number.isFinite)) {
      const hostCores = await readHostCpuCores();
      return { load: [l1, l5, l15], cores: hostCores ?? os.cpus().length, source: "host" };
    }
  } catch { /* fall through */ }
  const [l1, l5, l15] = os.loadavg();
  return { load: [l1, l5, l15], cores: os.cpus().length, source: "container" };
}

async function readHostUptimeSec(): Promise<{ uptime: number; source: "host" | "container" }> {
  try {
    const raw = await fsp.readFile("/host/proc/uptime", "utf8");
    const up = Number(raw.trim().split(/\s+/)[0]);
    if (Number.isFinite(up)) return { uptime: Math.floor(up), source: "host" };
  } catch { /* fall through */ }
  return { uptime: Math.floor(os.uptime()), source: "container" };
}

async function readDiskUploads(): Promise<{ total: number; free: number; used: number; label: string } | null> {
  const candidates: Array<{ path: string; label: string }> = [
    process.env.UPLOADS_DIR ? { path: process.env.UPLOADS_DIR, label: "uploads" } : null!,
    { path: path.resolve(process.cwd(), "uploads"), label: "uploads" },
    { path: "/app/uploads", label: "uploads" },
    { path: "/", label: "rootfs" },
  ].filter(Boolean);
  for (const { path: p, label } of candidates) {
    try {
      // fs.statfs is Node 18.15+
      const st: any = await new Promise((resolve, reject) =>
        (fs as any).statfs(p, (err: any, s: any) => (err ? reject(err) : resolve(s)))
      );
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      const used = total - free;
      if (total > 0) return { total, free, used, label };
    } catch { /* try next */ }
  }
  return null;
}

router.get("/system", requireAuth, async (_req, res) => {
  const checked_at = new Date().toISOString();

  // DB health + size + connection count
  let dbStatus: "ok" | "error" = "error";
  let dbLatency = 0;
  let dbSizeBytes: number | null = null;
  let dbConnections: number | null = null;
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatency = Date.now() - t0;
    dbStatus = "ok";
    try {
      const sizeRow: any = await db.execute(sql`SELECT pg_database_size(current_database()) AS bytes`);
      const rows = (sizeRow?.rows ?? sizeRow) as any[];
      dbSizeBytes = rows?.[0]?.bytes != null ? Number(rows[0].bytes) : null;
    } catch { /* size optional */ }
    try {
      const connRow: any = await db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'`);
      const rows = (connRow?.rows ?? connRow) as any[];
      dbConnections = rows?.[0]?.n != null ? Number(rows[0].n) : null;
    } catch { /* conn count optional */ }
  } catch { dbStatus = "error"; }

  let cameraTotal = 0, cameraOnline = 0, cameraOffline = 0, cameraError = 0;
  try {
    const camRes: any = await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM cameras GROUP BY status`);
    const camRows = (camRes?.rows ?? camRes) as Array<{ status: string; n: number }>;
    for (const r of camRows) {
      cameraTotal += Number(r.n);
      if (r.status === "online")  cameraOnline  = Number(r.n);
      if (r.status === "offline") cameraOffline = Number(r.n);
      if (r.status === "error")   cameraError   = Number(r.n);
    }
  } catch { /* counters stay 0 */ }

  let entranceTotal = 0, entranceActive = 0;
  try {
    const entRes: any = await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM entrances GROUP BY status`);
    const entRows = (entRes?.rows ?? entRes) as Array<{ status: string; n: number }>;
    for (const r of entRows) {
      entranceTotal += Number(r.n);
      if (r.status === "active") entranceActive = Number(r.n);
    }
  } catch { /* counters stay 0 */ }

  // OCR worker heartbeat — inferred from most recent access_events row.
  // Read-only; no worker-loop changes.
  let ocrStatus: "ok" | "degraded" | "error" | "not_configured" = "not_configured";
  let ocrDetail = "No recent activity";
  let ocrLastSeenSec: number | null = null;
  try {
    const lastRow: any = await db.execute(sql`SELECT MAX("timestamp") AS ts FROM access_events`);
    const rows = (lastRow?.rows ?? lastRow) as any[];
    const ts = rows?.[0]?.ts;
    if (ts) {
      const lastMs = new Date(ts).getTime();
      const ageSec = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
      ocrLastSeenSec = ageSec;
      if (ageSec < 300)        { ocrStatus = "ok";        ocrDetail = `Last detection ${ageSec}s ago`; }
      else if (ageSec < 3600)  { ocrStatus = "degraded";  ocrDetail = `Last detection ${Math.floor(ageSec / 60)}m ago`; }
      else                     { ocrStatus = "degraded";  ocrDetail = `Last detection ${Math.floor(ageSec / 3600)}h ago`; }
    } else {
      ocrStatus = "not_configured";
      ocrDetail = "No access events recorded yet";
    }
  } catch {
    ocrStatus = "error";
    ocrDetail = "Failed to read access_events";
  }

  // Host metrics (Tier 1 + 1.5)
  const [mem, load, hostUp, disk] = await Promise.all([
    readHostMem(),
    readHostLoad(),
    readHostUptimeSec(),
    readDiskUploads(),
  ]);

  const memUsed = mem.total - mem.available;
  const memUsedPct = mem.total > 0 ? Math.round((memUsed / mem.total) * 1000) / 10 : 0;
  const cpuPct = load.cores > 0 ? Math.round((load.load[0] / load.cores) * 1000) / 10 : 0;
  const diskUsedPct = disk && disk.total > 0 ? Math.round((disk.used / disk.total) * 1000) / 10 : null;

  const rssBytes = process.memoryUsage().rss;

  res.json({
    checked_at,
    components: {
      database: {
        status: dbStatus,
        latency_ms: dbLatency,
        detail: dbStatus === "ok"
          ? `PostgreSQL${dbSizeBytes != null ? ` · ${(dbSizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}${dbConnections != null ? ` · ${dbConnections} conn` : ""}`
          : "PostgreSQL unreachable",
      },
      api:        { status: "ok",       latency_ms: 0,    detail: `Express API · RSS ${Math.round(rssBytes / 1024 / 1024)} MB` },
      event_bus:  { status: "ok",       latency_ms: null, detail: "In-process SSE event bus" },
      ocr_worker: { status: ocrStatus,  latency_ms: ocrLastSeenSec, detail: ocrDetail },
      ai_engine:  { status: "not_configured", latency_ms: null, detail: "AI recognition — not yet active" },
    },
    cameras: {
      total:   cameraTotal,
      online:  cameraOnline,
      offline: cameraOffline,
      error:   cameraError,
    },
    entrances: {
      total:  entranceTotal,
      active: entranceActive,
    },
    host: {
      cpu: {
        cores: load.cores,
        load_1: load.load[0],
        load_5: load.load[1],
        load_15: load.load[2],
        used_pct: cpuPct,
        source: load.source,
      },
      memory: {
        total_bytes: mem.total,
        used_bytes: memUsed,
        available_bytes: mem.available,
        used_pct: memUsedPct,
        source: mem.source,
      },
      disk: disk
        ? { label: disk.label, total_bytes: disk.total, used_bytes: disk.used, free_bytes: disk.free, used_pct: diskUsedPct }
        : null,
      uptime_seconds: hostUp.uptime,
      uptime_source: hostUp.source,
    },
    database_detail: {
      size_bytes: dbSizeBytes,
      connections: dbConnections,
    },
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

export { router as diagnosticsRouter };
