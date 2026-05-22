/**
 * ANPR service — V1 (snapshot-polling pipeline).
 *
 * Called by the Python ai-worker via POST /api/anpr/detection.
 *
 * Pipeline (per detection):
 *   1. Normalise plate.
 *   2. Server-side debounce: skip if same plate seen on same camera within
 *      camera.anpr_cooldown_seconds. (Worker also debounces locally; this is
 *      defence-in-depth.)
 *   3. Look up vehicle by plate; auto-create if unknown (status="unknown",
 *      access_type defaults to "reservation" via DB default).
 *   4. Resolve villa via camera → entrance → villa. Bail if no villa link.
 *   5. Call existing validateVehicleAccess() — single source of truth.
 *   6. Log access_event (always — allowed OR denied).
 *   7. If allowed: trigger the camera's on-board relay via the existing
 *      camera adapter (cameras.gate_no).
 *   8. Update camera.last_anpr_plate / last_anpr_at.
 *
 * V1 does NOT use make/model/color/embedding even though the detection
 * payload accepts them — they are persisted into access_events.notes (JSON)
 * for future multi-factor matching without contract changes.
 */

import { db } from "@workspace/db";
import {
  vehiclesTable,
  camerasTable,
  entrancesTable,
  accessEventsTable,
} from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { validateVehicleAccess } from "../lib/validation/reservation-validator";
import { createAdapter } from "../lib/cameras/factory";
import { eventBus } from "../lib/events";

export interface AnprDetectionInput {
  camera_id: string;
  plate: string;
  confidence: number; // 0–100
  snapshot_url?: string | null;
  // Reserved for future multi-factor matching (not used in V1):
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicle_type?: string | null;
  embedding?: number[] | null;
  raw_ocr_text?: string | null;
}

export interface AnprDetectionResult {
  action:
    | "skipped_cooldown"
    | "skipped_no_villa"
    | "denied"
    | "allowed_relay_ok"
    | "allowed_relay_failed";
  plate: string;
  vehicle_id?: string;
  reason?: string;
  denial_code?: string;
  gate?: { success: boolean; error?: string };
}

function normalisePlate(p: string): string {
  return p.trim().toUpperCase().replace(/\s+/g, "");
}

export async function handleAnprDetection(
  input: AnprDetectionInput,
): Promise<AnprDetectionResult> {
  const plate = normalisePlate(input.plate);
  if (!plate) {
    return { action: "skipped_no_villa", plate, reason: "Empty plate" };
  }

  // ── 1. Load camera + entrance + villa ──────────────────────────────────────
  const camRows = await db
    .select()
    .from(camerasTable)
    .where(eq(camerasTable.id, input.camera_id))
    .limit(1);
  const camera = camRows[0];
  if (!camera) {
    return { action: "skipped_no_villa", plate, reason: "Camera not found" };
  }

  // Enforce OCR toggle server-side — a stale worker target cache must not
  // be able to trigger access after OCR is disabled on a camera.
  if (!camera.ocr_enabled) {
    return { action: "skipped_no_villa", plate, reason: "Camera OCR disabled" };
  }

  let villa_id: string | null = null;
  if (camera.entrance_id) {
    const entRows = await db
      .select({ villa_id: entrancesTable.villa_id })
      .from(entrancesTable)
      .where(eq(entrancesTable.id, camera.entrance_id))
      .limit(1);
    villa_id = entRows[0]?.villa_id ?? null;
  }
  if (!villa_id) {
    return {
      action: "skipped_no_villa",
      plate,
      reason: "Camera has no entrance/villa link",
    };
  }

  // ── 2. Atomic cooldown claim ───────────────────────────────────────────────
  // Conditional UPDATE: succeeds only if this (camera, plate) is NOT in
  // cooldown. Two concurrent detections for the same plate will race here
  // and only one will get rowCount=1; the loser is told it's in cooldown.
  const cooldownSecs = camera.anpr_cooldown_seconds ?? 30;
  const now = new Date();
  const claimed = await db
    .update(camerasTable)
    .set({ last_anpr_plate: plate, last_anpr_at: now, updated_at: now })
    .where(
      and(
        eq(camerasTable.id, camera.id),
        or(
          sql`${camerasTable.last_anpr_plate} IS DISTINCT FROM ${plate}`,
          isNull(camerasTable.last_anpr_at),
          lt(
            camerasTable.last_anpr_at,
            sql`NOW() - (${cooldownSecs} || ' seconds')::interval`,
          ),
        ),
      ),
    )
    .returning({ id: camerasTable.id });

  if (claimed.length === 0) {
    return { action: "skipped_cooldown", plate };
  }

  // ── 3. Lookup-or-create vehicle (concurrency-safe via ON CONFLICT) ───────
  let vehicle_id: string;
  const inserted = await db
    .insert(vehiclesTable)
    .values({
      license_plate: plate,
      make: input.make?.trim() || null,
      model: input.model?.trim() || null,
      color: input.color?.trim() || null,
      status: "unknown",
      // access_type defaults to "reservation" at DB level.
    })
    .onConflictDoNothing({ target: vehiclesTable.license_plate })
    .returning({ id: vehiclesTable.id });

  if (inserted[0]) {
    vehicle_id = inserted[0].id;
  } else {
    const existing = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.license_plate, plate))
      .limit(1);
    if (!existing[0]) {
      // Should be impossible (we just attempted insert), but stay defensive.
      return { action: "skipped_no_villa", plate, reason: "Vehicle row missing after upsert" };
    }
    vehicle_id = existing[0].id;
  }

  // ── 4. Validate via existing single source of truth ───────────────────────
  const decision = await validateVehicleAccess(vehicle_id, villa_id);

  // ── 6. Build notes (for future multi-factor matching) ─────────────────────
  const futureMeta = {
    confidence: input.confidence,
    raw_ocr_text: input.raw_ocr_text ?? null,
    make: input.make ?? null,
    model: input.model ?? null,
    color: input.color ?? null,
    vehicle_type: input.vehicle_type ?? null,
    has_embedding: !!input.embedding,
    decision_reason: decision.reason,
  };

  // ── 7. Denied path ────────────────────────────────────────────────────────
  if (!decision.allowed) {
    await db.insert(accessEventsTable).values({
      event_type: "denied",
      status: "denied",
      confidence_score: input.confidence,
      vehicle_id,
      license_plate: plate,
      entrance_id: camera.entrance_id,
      camera_id: camera.id,
      snapshot_url: input.snapshot_url ?? null,
      notes: JSON.stringify(futureMeta),
    });

    void eventBus.publish({
      event_type: "anpr.denied",
      severity: "warning",
      camera_id: camera.id,
      vehicle_id,
      source: "ai_worker",
      payload: { plate, reason: decision.reason, denial_code: decision.denial_code },
    });

    return {
      action: "denied",
      plate,
      vehicle_id,
      reason: decision.reason,
      denial_code: decision.denial_code,
    };
  }

  // ── 8. Allowed path: trigger relay ───────────────────────────────────────
  const adapter = createAdapter(camera);
  const gate = await adapter.open_gate();

  await db.insert(accessEventsTable).values({
    event_type: "entry",
    status: gate.success ? "allowed" : "denied",
    confidence_score: input.confidence,
    vehicle_id,
    license_plate: plate,
    entrance_id: camera.entrance_id,
    camera_id: camera.id,
    snapshot_url: input.snapshot_url ?? null,
    notes: JSON.stringify({
      ...futureMeta,
      gate_success: gate.success,
      gate_error: gate.error ?? null,
    }),
  });

  void eventBus.publish({
    event_type: gate.success ? "anpr.allowed" : "anpr.relay_failed",
    severity: gate.success ? "info" : "error",
    camera_id: camera.id,
    vehicle_id,
    source: "ai_worker",
    payload: {
      plate,
      reason: decision.reason,
      gate_success: gate.success,
      gate_error: gate.error,
    },
  });

  return {
    action: gate.success ? "allowed_relay_ok" : "allowed_relay_failed",
    plate,
    vehicle_id,
    reason: decision.reason,
    gate: { success: gate.success, error: gate.error },
  };
}
