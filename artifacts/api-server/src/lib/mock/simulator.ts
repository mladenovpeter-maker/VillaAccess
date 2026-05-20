import { db } from "@workspace/db";
import { vehiclesTable, camerasTable, villasTable, accessEventsTable } from "@workspace/db";
import { ne, eq, sql } from "drizzle-orm";
import { eventBus } from "../events";
import { saveMockSnapshot } from "./snapshot-generator";

// ── Config & State ─────────────────────────────────────────────────────────────

export interface SimulatorConfig {
  interval_ms: number;
  auto_open_gate: boolean;
  include_unknown: boolean;
  error_rate: number;
  detection_mode: "all" | "known" | "unknown";
}

export interface SimulatorStatus {
  running: boolean;
  events_fired: number;
  last_event_at: string | null;
  started_at: string | null;
  config: SimulatorConfig;
}

const DEFAULT_CONFIG: SimulatorConfig = {
  interval_ms: 8000,
  auto_open_gate: true,
  include_unknown: true,
  error_rate: 0.05,
  detection_mode: "all",
};

// ── Mock data fallbacks (when DB has no cameras/vehicles) ──────────────────────

const MOCK_CAMERAS = [
  { id: null, name: "CAM-01 Gate A", villa_id: null, villaName: "Villa Sunrise" },
  { id: null, name: "CAM-02 Gate B", villa_id: null, villaName: "Villa Sunset" },
  { id: null, name: "CAM-03 Entry",  villa_id: null, villaName: "Villa Ocean View" },
];

const MOCK_VEHICLE_POOL = [
  { plate: "DK 1234 AAA", make: "Toyota",   model: "Alphard",  color: "Silver" },
  { plate: "DK 5678 BCD", make: "Honda",    model: "CR-V",     color: "Black" },
  { plate: "DK 9012 EFG", make: "BMW",      model: "X5",       color: "White" },
  { plate: "B  2233 HIJ", make: "Mercedes", model: "Vito",     color: "Black" },
  { plate: "B  4455 KLM", make: "Toyota",   model: "Fortuner", color: "Gray" },
  { plate: "DK 6677 NOP", make: "Suzuki",   model: "Jimny",    color: "Green" },
  { plate: "AB 8899 QRS", make: "Hyundai",  model: "Tucson",   color: "Blue" },
  { plate: "N  1122 TUV", make: "Toyota",   model: "Avanza",   color: "White" },
];

const UNKNOWN_PLATE_PREFIXES = ["DK","B","AB","N","L","D","F"];

function randomUnknownPlate() {
  const pre = UNKNOWN_PLATE_PREFIXES[Math.floor(Math.random() * UNKNOWN_PLATE_PREFIXES.length)];
  const num = String(Math.floor(1000 + Math.random() * 8999));
  const suf = String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
              String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
              String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${pre} ${num} ${suf}`;
}

function applyOcrError(plate: string, errorRate: number): string {
  if (Math.random() > errorRate) return plate;
  const idx = Math.floor(Math.random() * plate.length);
  const chars = plate.split("");
  const replacements: Record<string, string[]> = {
    "0": ["O","Q"], "O": ["0","Q"], "1": ["I","L"], "I": ["1","L"],
    "5": ["S"],     "S": ["5"],     "8": ["B"],     "B": ["8"],
    "6": ["G"],     "G": ["6"],
  };
  const ch = chars[idx].toUpperCase();
  const options = replacements[ch];
  if (options) chars[idx] = options[Math.floor(Math.random() * options.length)];
  return chars.join("");
}

/** Heavy OCR garbling — simulates a dirty/obscured plate (40–70% character noise). */
function garblePlate(plate: string, rate: number): string {
  const noise = ["*", "?", "8", "0", "1", "B", "S", "~", "#", "X", "Z"];
  return plate.split("").map((ch) => {
    if (ch === " ") return ch;
    return Math.random() < rate
      ? noise[Math.floor(Math.random() * noise.length)]
      : ch;
  }).join("");
}

// ── Singleton Simulator ────────────────────────────────────────────────────────

class MockSimulator {
  private handle: ReturnType<typeof setInterval> | null = null;
  private config: SimulatorConfig = { ...DEFAULT_CONFIG };
  private eventsFired = 0;
  private lastEventAt: string | null = null;
  private startedAt: string | null = null;

  get status(): SimulatorStatus {
    return {
      running:        this.handle !== null,
      events_fired:   this.eventsFired,
      last_event_at:  this.lastEventAt,
      started_at:     this.startedAt,
      config:         { ...this.config },
    };
  }

  start(overrides: Partial<SimulatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
    if (this.handle) clearInterval(this.handle);
    this.startedAt = new Date().toISOString();
    this.handle = setInterval(() => void this.tick(), this.config.interval_ms);
    console.log(`[MockSimulator] started — interval ${this.config.interval_ms}ms`);
    void this.tick();
    return this.status;
  }

  stop() {
    if (this.handle) { clearInterval(this.handle); this.handle = null; }
    console.log(`[MockSimulator] stopped — ${this.eventsFired} events fired`);
    return this.status;
  }

  async triggerOnce(params: { vehicle_id?: string; villa_id?: string; plate?: string; confidence?: number } = {}) {
    return this.tick(params);
  }

  // ── Denied Access ────────────────────────────────────────────────────────────

  async simulateDenied(params: {
    plate?: string;
    reason?: "blacklisted" | "unregistered" | "no_reservation" | "outside_window";
  } = {}) {
    const DENY_REASONS = ["blacklisted", "unregistered", "no_reservation", "outside_window"] as const;
    const reason = params.reason ?? DENY_REASONS[Math.floor(Math.random() * DENY_REASONS.length)];

    // Pick a plate — prefer a known blacklisted vehicle from DB, else invent one
    let plate = params.plate;
    let vehicleId: string | null = null;
    if (!plate) {
      if (reason === "blacklisted") {
        const bl = await db.select().from(vehiclesTable).where(eq(vehiclesTable.status, "blacklisted" as any)).limit(5);
        if (bl.length > 0) {
          const v = bl[Math.floor(Math.random() * bl.length)];
          plate = v.license_plate;
          vehicleId = v.id;
        }
      }
      if (!plate) plate = randomUnknownPlate();
    }

    const confidence = 72 + Math.random() * 24;

    // Get a camera for the snapshot
    const cams = await db.select({ id: camerasTable.id, name: camerasTable.name, villa_id: camerasTable.villa_id })
      .from(camerasTable).limit(8);
    const camera = cams.length > 0 ? cams[Math.floor(Math.random() * cams.length)] : MOCK_CAMERAS[0];

    const snapshotUrl = await saveMockSnapshot({
      plate,
      cameraName: camera.name,
      confidence: Math.round(confidence * 10) / 10,
      detected: true,
    });

    await db.insert(accessEventsTable).values({
      event_type: "denied",
      status: "denied",
      license_plate: plate,
      vehicle_id: vehicleId,
      villa_id: (camera as any).villa_id ?? null,
      camera_id: (camera as any).id ?? null,
      snapshot_url: snapshotUrl,
      confidence_score: confidence / 100,
      notes: `[MOCK] Access denied — reason: ${reason}`,
    });

    void eventBus.publish({
      event_type: "access.denied",
      severity: "warning",
      vehicle_id: vehicleId,
      villa_id: (camera as any).villa_id ?? null,
      source: "mock",
      payload: { plate, reason, confidence: Math.round(confidence * 10) / 10, mock: true },
    });

    this.eventsFired++;
    this.lastEventAt = new Date().toISOString();
    return { plate, reason, confidence: Math.round(confidence * 10) / 10, snapshot_url: snapshotUrl };
  }

  // ── Dirty Plate ──────────────────────────────────────────────────────────────

  async simulateDirtyPlate(params: { plate?: string } = {}) {
    const realPlate = params.plate ?? randomUnknownPlate();
    // Dirty confidence: 10–40%
    const confidence = 10 + Math.random() * 30;
    // Garble 40–65% of characters
    const garbleRate = 0.40 + Math.random() * 0.25;
    const garbledPlate = garblePlate(realPlate, garbleRate);

    const cams = await db.select({ id: camerasTable.id, name: camerasTable.name, villa_id: camerasTable.villa_id })
      .from(camerasTable).limit(8);
    const camera = cams.length > 0 ? cams[Math.floor(Math.random() * cams.length)] : MOCK_CAMERAS[0];

    const snapshotUrl = await saveMockSnapshot({
      plate: garbledPlate,
      cameraName: camera.name,
      confidence: Math.round(confidence * 10) / 10,
      detected: true,
    });

    await db.insert(accessEventsTable).values({
      event_type: "entry",
      status: "pending",
      license_plate: garbledPlate,
      villa_id: (camera as any).villa_id ?? null,
      camera_id: (camera as any).id ?? null,
      snapshot_url: snapshotUrl,
      confidence_score: confidence / 100,
      notes: `[MOCK] Dirty/obscured plate — OCR unreliable (garble rate ${Math.round(garbleRate * 100)}%)`,
    });

    void eventBus.publish({
      event_type: "ai.ocr_scan",
      severity: "warning",
      source: "mock",
      payload: {
        raw_plate: realPlate,
        corrected_plate: garbledPlate,
        confidence: Math.round(confidence * 10) / 10,
        quality: "poor",
        reason: "dirty_plate",
        garble_rate: Math.round(garbleRate * 100),
        mock: true,
      },
    });

    this.eventsFired++;
    this.lastEventAt = new Date().toISOString();
    return {
      garbled_plate: garbledPlate,
      real_plate: realPlate,
      confidence: Math.round(confidence * 10) / 10,
      snapshot_url: snapshotUrl,
    };
  }

  async triggerGate(villaId: string) {
    void eventBus.publish({
      event_type: "gate.opened",
      severity:   "info",
      villa_id:   villaId,
      source:     "mock",
      payload:    { trigger: "manual_mock", auto: false, mock: true },
    });
    return { success: true, villa_id: villaId };
  }

  async triggerOcr(params: { plate?: string; camera_id?: string } = {}) {
    const plate      = params.plate ?? randomUnknownPlate();
    const confidence = Math.round((72 + Math.random() * 27) * 10) / 10;
    const corrected  = applyOcrError(plate, this.config.error_rate);

    void eventBus.publish({
      event_type: "ai.ocr_scan",
      severity:   "info",
      source:     "mock",
      payload:    { raw_plate: plate, corrected_plate: corrected, confidence, mock: true },
    });

    return { plate: corrected, raw_plate: plate, confidence };
  }

  private async tick(params: { vehicle_id?: string; villa_id?: string; plate?: string; confidence?: number } = {}) {
    try {
      const now = new Date();

      // 1. Get real cameras from DB or fall back to mock list
      const dbCameras = await db
        .select({
          id:        camerasTable.id,
          name:      camerasTable.name,
          villa_id:  camerasTable.villa_id,
          villaName: villasTable.name,
        })
        .from(camerasTable)
        .leftJoin(villasTable, eq(camerasTable.villa_id, villasTable.id))
        .limit(16);

      const cameras = dbCameras.length > 0 ? dbCameras : MOCK_CAMERAS;
      const camera  = params.villa_id
        ? (cameras.find((c) => c.villa_id === params.villa_id) ?? cameras[0])
        : cameras[Math.floor(Math.random() * cameras.length)];

      // 2. Determine vehicle
      let vehicleId:    string | null = null;
      let vehicleMake:  string | null = null;
      let vehicleModel: string | null = null;
      let detectedPlate: string;

      if (params.vehicle_id) {
        const rows = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.vehicle_id)).limit(1);
        if (rows[0]) {
          vehicleId    = rows[0].id;
          vehicleMake  = rows[0].make;
          vehicleModel = rows[0].model;
          detectedPlate = rows[0].license_plate;
        } else {
          detectedPlate = params.plate ?? randomUnknownPlate();
        }
      } else if (params.plate) {
        detectedPlate = params.plate;
      } else {
        const useUnknown =
          this.config.detection_mode === "unknown" ||
          (this.config.detection_mode === "all" && this.config.include_unknown && Math.random() < 0.25);

        if (useUnknown) {
          // Invent a plate from mock pool or random
          const mock = MOCK_VEHICLE_POOL[Math.floor(Math.random() * MOCK_VEHICLE_POOL.length)];
          detectedPlate = randomUnknownPlate();
          vehicleMake  = mock.make;
          vehicleModel = mock.model;
        } else {
          // Pick a known vehicle from DB
          const knownVehicles = await db
            .select()
            .from(vehiclesTable)
            .where(ne(vehiclesTable.status, "blacklisted" as any))
            .limit(30);

          if (knownVehicles.length > 0) {
            const v = knownVehicles[Math.floor(Math.random() * knownVehicles.length)];
            vehicleId    = v.id;
            vehicleMake  = v.make;
            vehicleModel = v.model;
            detectedPlate = v.license_plate;
          } else {
            // Fall back to mock vehicle pool
            const mock = MOCK_VEHICLE_POOL[Math.floor(Math.random() * MOCK_VEHICLE_POOL.length)];
            detectedPlate = mock.plate;
            vehicleMake  = mock.make;
            vehicleModel = mock.model;
          }
        }
      }

      // 3. Confidence + OCR error simulation
      const rawConfidence  = params.confidence !== undefined
        ? params.confidence
        : 75 + Math.random() * 24;
      const confidence     = Math.round(rawConfidence * 10) / 10;
      const ocrPlate       = applyOcrError(detectedPlate, this.config.error_rate);

      // 4. Generate mock snapshot
      const snapshotUrl = await saveMockSnapshot({
        plate:      ocrPlate,
        cameraName: camera.name,
        villaName:  (camera as any).villaName ?? "",
        confidence,
        detected:   true,
      });

      // 5. Store access event in DB
      await db.insert(accessEventsTable).values({
        event_type:       "entry",
        status:           "allowed",
        license_plate:    ocrPlate,
        vehicle_id:       vehicleId,
        villa_id:         camera.villa_id ?? null,
        camera_id:        (camera as any).id ?? null,
        snapshot_url:     snapshotUrl,
        confidence_score: confidence / 100,
        notes:            `[MOCK] ${vehicleMake ?? "Unknown"} ${vehicleModel ?? "Vehicle"}`,
      });

      // 6. Emit domain events
      void eventBus.publish({
        event_type: "vehicle.detected",
        severity:   "info",
        vehicle_id: vehicleId,
        villa_id:   camera.villa_id ?? null,
        camera_id:  (camera as any).id ?? null,
        source:     "mock",
        payload: {
          plate:        ocrPlate,
          raw_plate:    detectedPlate,
          confidence,
          camera_name:  camera.name,
          make:         vehicleMake,
          model:        vehicleModel,
          mock:         true,
        },
      });

      // 7. Auto gate-open
      if (this.config.auto_open_gate && camera.villa_id) {
        void eventBus.publish({
          event_type: "gate.opened",
          severity:   "info",
          villa_id:   camera.villa_id,
          source:     "mock",
          payload:    { trigger: "auto_detection", plate: ocrPlate, mock: true },
        });
      }

      // 8. Update vehicle last_seen if known
      if (vehicleId) {
        await db
          .update(vehiclesTable)
          .set({ last_seen: now, total_visits: sql`${vehiclesTable.total_visits} + 1`, updated_at: now })
          .where(eq(vehiclesTable.id, vehicleId));
      }

      this.eventsFired++;
      this.lastEventAt = now.toISOString();
      return { plate: ocrPlate, confidence, camera: camera.name, snapshot_url: snapshotUrl };
    } catch (err) {
      console.error("[MockSimulator] tick error:", err);
      return null;
    }
  }
}

export const simulator = new MockSimulator();
