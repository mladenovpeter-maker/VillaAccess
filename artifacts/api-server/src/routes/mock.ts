import { Router } from "express";
import { requireAuth } from "./auth";
import { simulator } from "../lib/mock/simulator";
import { saveMockSnapshot } from "../lib/mock/snapshot-generator";
import { z } from "zod";

const router = Router();

// GET /mock/status
router.get("/status", requireAuth, (_req, res) => {
  res.json(simulator.status);
});

// POST /mock/start
router.post("/start", requireAuth, async (req, res) => {
  const schema = z.object({
    interval_ms:      z.number().int().min(1000).max(60000).optional(),
    auto_open_gate:   z.boolean().optional(),
    include_unknown:  z.boolean().optional(),
    error_rate:       z.number().min(0).max(1).optional(),
    detection_mode:   z.enum(["all", "known", "unknown"]).optional(),
  });
  const body = schema.safeParse(req.body);
  const config = body.success ? body.data : {};
  res.json(simulator.start(config));
});

// POST /mock/stop
router.post("/stop", requireAuth, (_req, res) => {
  res.json(simulator.stop());
});

// POST /mock/trigger  — fire one simulated detection
router.post("/trigger", requireAuth, async (req, res) => {
  const schema = z.object({
    vehicle_id: z.string().optional(),
    villa_id:   z.string().optional(),
    plate:      z.string().optional(),
  });
  const body = schema.safeParse(req.body);
  const params = body.success ? body.data : {};
  const result = await simulator.triggerOnce(params);
  if (!result) { res.status(500).json({ detail: "Simulation tick failed" }); return; }
  res.json({ success: true, ...result });
});

// POST /mock/gate  — simulate gate open for a villa
router.post("/gate", requireAuth, async (req, res) => {
  const schema = z.object({ villa_id: z.string() });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "villa_id is required" }); return; }
  const result = await simulator.triggerGate(body.data.villa_id);
  res.json(result);
});

// POST /mock/ocr  — simulate OCR scan result
router.post("/ocr", requireAuth, async (req, res) => {
  const schema = z.object({
    plate:     z.string().optional(),
    camera_id: z.string().optional(),
  });
  const body = schema.safeParse(req.body);
  const params = body.success ? body.data : {};
  const result = await simulator.triggerOcr(params);
  res.json(result);
});

// GET /mock/snapshot  — generate a preview SVG snapshot (inline, no DB)
router.get("/snapshot", requireAuth, async (req, res) => {
  const plate      = (req.query.plate as string) || "DK 1234 ABC";
  const cameraName = (req.query.camera as string) || "CAM-01 Mock";
  const confidence = parseFloat((req.query.confidence as string) || "92.5");
  const detected   = req.query.detected !== "false";

  try {
    const { generateSvg } = await import("../lib/mock/snapshot-generator");
    const svg = generateSvg({ plate, cameraName, confidence, detected });
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.send(svg);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// GET /mock/vehicles  — list vehicles the simulator can use
router.get("/vehicles", requireAuth, async (_req, res) => {
  const { db } = await import("@workspace/db");
  const { vehiclesTable } = await import("@workspace/db");
  const { ne } = await import("drizzle-orm");

  const dbVehicles = await db
    .select({ id: vehiclesTable.id, license_plate: vehiclesTable.license_plate, make: vehiclesTable.make, model: vehiclesTable.model, status: vehiclesTable.status })
    .from(vehiclesTable)
    .limit(50);

  const MOCK_VEHICLE_POOL = [
    { id: null, license_plate: "DK 1234 AAA", make: "Toyota",   model: "Alphard",  status: "mock" },
    { id: null, license_plate: "DK 5678 BCD", make: "Honda",    model: "CR-V",     status: "mock" },
    { id: null, license_plate: "DK 9012 EFG", make: "BMW",      model: "X5",       status: "mock" },
    { id: null, license_plate: "B  2233 HIJ", make: "Mercedes", model: "Vito",     status: "mock" },
    { id: null, license_plate: "B  4455 KLM", make: "Toyota",   model: "Fortuner", status: "mock" },
    { id: null, license_plate: "DK 6677 NOP", make: "Suzuki",   model: "Jimny",    status: "mock" },
    { id: null, license_plate: "AB 8899 QRS", make: "Hyundai",  model: "Tucson",   status: "mock" },
    { id: null, license_plate: "N  1122 TUV", make: "Toyota",   model: "Avanza",   status: "mock" },
  ];

  res.json({
    real: dbVehicles,
    mock_pool: MOCK_VEHICLE_POOL,
    total_real: dbVehicles.length,
  });
});

export { router as mockRouter };
