/**
 * ANPR routes — V1 (called by the Python ai-worker only).
 *
 * Auth: shared-secret bearer token in `ANPR_WORKER_TOKEN` env var.
 * The worker sends `Authorization: Bearer <token>`. No user session.
 *
 * Endpoints:
 *   GET  /api/anpr/targets         → list of OCR-enabled cameras to poll
 *   GET  /api/anpr/snapshot/:id    → current JPEG snapshot (base64 data URL)
 *   POST /api/anpr/detection       → submit a recognised plate
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { camerasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createAdapter } from "../lib/cameras/factory";
import { handleAnprDetection } from "../services/anpr";

const router = Router();

// ─── Worker auth middleware ──────────────────────────────────────────────────

function requireWorkerToken(req: any, res: any, next: any) {
  const expectedRaw = process.env["ANPR_WORKER_TOKEN"];
  if (!expectedRaw) {
    res.status(503).json({
      detail: "ANPR_WORKER_TOKEN is not configured on the server",
    });
    return;
  }
  const expected = expectedRaw.trim();

  // Accept either:
  //   Authorization: Bearer <token>
  //   X-Anpr-Token: <token>
  // Express lowercases all incoming header names.
  const authHeader = String(req.headers["authorization"] ?? "").trim();
  const xHeader = String(req.headers["x-anpr-token"] ?? "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const token = bearer || xHeader;

  if (!token || token !== expected) {
    console.warn(
      `[anpr] auth reject path=${req.path} ` +
        `expected_len=${expected.length} bearer_len=${bearer.length} ` +
        `xtoken_len=${xHeader.length}`,
    );
    res.status(401).json({ detail: "Invalid worker token" });
    return;
  }
  next();
}

router.use(requireWorkerToken);

// ─── GET /api/anpr/targets ───────────────────────────────────────────────────

router.get("/targets", async (_req, res) => {
  const rows = await db
    .select({
      id: camerasTable.id,
      name: camerasTable.name,
      polling_interval_ms: camerasTable.polling_interval_ms,
      ocr_min_confidence: camerasTable.ocr_min_confidence,
      anpr_cooldown_seconds: camerasTable.anpr_cooldown_seconds,
      entrance_id: camerasTable.entrance_id,
    })
    .from(camerasTable)
    .where(eq(camerasTable.ocr_enabled, true));

  res.json({ cameras: rows });
});

// ─── GET /api/anpr/snapshot/:id ──────────────────────────────────────────────

router.get("/snapshot/:id", async (req, res) => {
  const rows = await db
    .select()
    .from(camerasTable)
    .where(eq(camerasTable.id, req.params.id))
    .limit(1);
  const cam = rows[0];
  if (!cam) {
    res.status(404).json({ detail: "Camera not found" });
    return;
  }
  if (!cam.ocr_enabled) {
    res.status(409).json({ detail: "Camera OCR is disabled" });
    return;
  }

  const adapter = createAdapter(cam);
  // Prefer the memory-only variant so high-frequency ANPR polling doesn't
  // fill uploads/. Fall back to get_snapshot() for adapters that don't
  // implement the ephemeral variant.
  const result = adapter.get_snapshot_ephemeral
    ? await adapter.get_snapshot_ephemeral()
    : await adapter.get_snapshot();
  if (!result.success || !result.snapshot_base64) {
    res.status(502).json({
      detail: "Snapshot fetch failed",
      error: result.error ?? "no_base64_returned",
    });
    return;
  }

  // snapshot_base64 is a data URL: "data:image/jpeg;base64,<payload>"
  const comma = result.snapshot_base64.indexOf(",");
  if (comma < 0) {
    res.status(502).json({ detail: "Malformed snapshot data URL" });
    return;
  }
  const buf = Buffer.from(result.snapshot_base64.slice(comma + 1), "base64");
  res.setHeader("Content-Type", result.mime_type ?? "image/jpeg");
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("X-Captured-At", result.captured_at ?? "");
  res.status(200).end(buf);
});

// ─── POST /api/anpr/detection ────────────────────────────────────────────────

const detectionSchema = z.object({
  camera_id: z.string().min(1),
  plate: z.string().min(1).max(20),
  confidence: z.number().min(0).max(100),
  snapshot_url: z.string().nullable().optional(),
  // Reserved for future multi-factor matching (accepted, not used in V1):
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  vehicle_type: z.string().nullable().optional(),
  embedding: z.array(z.number()).nullable().optional(),
  raw_ocr_text: z.string().nullable().optional(),
});

router.post("/detection", async (req, res) => {
  const body = detectionSchema.safeParse(req.body);
  if (!body.success) {
    res
      .status(400)
      .json({ detail: "Invalid detection payload", errors: body.error.issues });
    return;
  }

  try {
    const result = await handleAnprDetection(body.data);
    res.json(result);
  } catch (err: any) {
    console.error("[anpr] detection failed", err);
    res.status(500).json({
      detail: "ANPR detection handler crashed",
      error: err?.message ?? String(err),
    });
  }
});

export { router as anprRouter };
