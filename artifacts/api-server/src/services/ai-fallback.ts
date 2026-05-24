/**
 * AI fallback after N consecutive ANPR failures.
 *
 * ADDITIVE / OPT-IN: gated by env AI_FALLBACK_ENABLED=true. When OFF (default)
 * the exported hooks are no-ops, so OCR / YOLO / worker / relay / cooldown /
 * fuzzy / validator behaviour is completely unchanged.
 *
 * Flow (per camera):
 *   1. anpr.ts calls recordFailure() on every "denied" detection.
 *   2. The hook FIRES the camera adapter itself to grab a fresh JPEG from
 *      the gate camera (the worker doesn't ship snapshots in its detection
 *      payload — it only OCRs them and discards). The buffer is kept in
 *      memory so this works even when uploads/snapshots/ is empty / not
 *      mounted on prod.
 *   3. After FAIL_THRESHOLD failures within FAIL_RESET_MINUTES we send the
 *      collected snapshot buffers to OpenAI vision (gpt-4o-mini) and ask
 *      for the plate + make + colour + self-confidence.
 *   4. If AI confidence is high enough AND the plate corresponds to a
 *      registered vehicle with an active reservation for one of this
 *      entrance's villas, we open the gate via the existing CameraAdapter
 *      (same path as the normal allowed flow). We DO NOT auto-create
 *      vehicles (Vehicles page remains the source of truth).
 *   5. The three buffers are also persisted to uploads/snapshots/YYYY/MM/DD
 *      (same structure as the existing snapshots upload route) so the
 *      Events / Vehicles UI can show what AI looked at. The decision is
 *      logged as a regular access_events row with notes.ai_fallback=true.
 *   6. The per-camera counter resets after AI runs, after any allowed
 *      detection, and after FAIL_RESET_MINUTES of inactivity.
 *
 * State is in-memory (single-process server) — restart clears counters,
 * which is fine: the worst case is that the next 3 fails re-trigger AI.
 */

import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import * as crypto from "crypto";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  accessEventsTable,
  villaEntrancesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { validateVehicleAccessMulti } from "../lib/validation/reservation-validator";
import { createAdapter, type CameraRow } from "../lib/cameras/factory";
import { eventBus } from "../lib/events";
import { uploadsUrl } from "../lib/public-url";

// ── Tunables ─────────────────────────────────────────────────────────────────
const FAIL_THRESHOLD = 3;
const FAIL_RESET_MINUTES = 10;
const AI_CONFIDENCE_MIN = 70;
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 25_000;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024; // 8 MB per JPEG safety cap

// ── Storage paths ────────────────────────────────────────────────────────────
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const SNAPSHOTS_ROOT = path.resolve(UPLOADS_ROOT, "snapshots");

// ── Types ────────────────────────────────────────────────────────────────────
export interface AiFallbackCamera extends CameraRow {
  entrance_id?: string | null;
}

interface FailEntry {
  buffer: Buffer;
  mime: string;
  plate: string;
  at: number; // epoch ms
}

interface CameraState {
  fails: FailEntry[];
  inFlight: boolean;
}

interface AiVerdict {
  plate: string | null;
  make: string | null;
  color: string | null;
  confidence: number;
  reasoning?: string;
}

// ── State + client ───────────────────────────────────────────────────────────
const state = new Map<string, CameraState>();

let _client: OpenAI | null = null;
function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: key, timeout: OPENAI_TIMEOUT_MS });
  }
  return _client;
}

function isEnabled(): boolean {
  return process.env.AI_FALLBACK_ENABLED === "true";
}

// ── Snapshot capture (server-side, from the camera adapter) ──────────────────
async function captureFromCamera(
  camera: AiFallbackCamera,
): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const adapter = createAdapter(camera);
    // Prefer ephemeral (no disk write) — same call the /api/anpr/snapshot/:id
    // route uses, so it's already proven against real Hikvision/Dahua/ONVIF.
    const result = adapter.get_snapshot_ephemeral
      ? await adapter.get_snapshot_ephemeral()
      : await adapter.get_snapshot();
    if (!result.success || !result.snapshot_base64) {
      console.warn(`[ai-fallback] camera=${camera.id} snapshot grab failed`);
      return null;
    }
    const m = result.snapshot_base64.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) {
      console.warn(`[ai-fallback] camera=${camera.id} bad snapshot data URL`);
      return null;
    }
    const mime = m[1] || "image/jpeg";
    const buffer = Buffer.from(m[2], "base64");
    if (buffer.length === 0 || buffer.length > MAX_SNAPSHOT_BYTES) {
      console.warn(`[ai-fallback] camera=${camera.id} snapshot size out of range: ${buffer.length}`);
      return null;
    }
    return { buffer, mime };
  } catch (err) {
    console.warn(`[ai-fallback] camera=${camera.id} capture error:`, (err as Error).message);
    return null;
  }
}

async function persistSnapshot(
  buf: Buffer,
  mime: string,
): Promise<string | null> {
  try {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dir = path.join(SNAPSHOTS_ROOT, yyyy, mm, dd);
    await fs.mkdir(dir, { recursive: true });
    const ext =
      mime === "image/png" ? ".png"
      : mime === "image/webp" ? ".webp"
      : ".jpg";
    const filename = `ai_${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(dir, filename), buf);
    return uploadsUrl(`snapshots/${yyyy}/${mm}/${dd}/${filename}`);
  } catch (err) {
    console.error("[ai-fallback] persist snapshot failed:", (err as Error).message);
    return null;
  }
}

// ── OpenAI call (takes pre-built data URLs from buffers) ─────────────────────
async function askOpenAi(dataUrls: string[]): Promise<AiVerdict | null> {
  const client = getClient();
  if (!client) {
    console.warn("[ai-fallback] OPENAI_API_KEY not set — skipping AI call");
    return null;
  }
  if (dataUrls.length === 0) return null;

  const systemPrompt =
    "You are a license-plate recognition assistant for an automated villa gate. " +
    `You will be shown ${dataUrls.length} photo(s) taken seconds apart from the same gate camera. ` +
    "They most likely show the same vehicle approaching the gate. " +
    "Read the license plate, then identify the vehicle make and colour. " +
    "Respond ONLY with strict JSON of this exact shape (no markdown, no commentary):\n" +
    `{"plate":"ABCD1234","make":"Toyota","color":"white","confidence":85,"reasoning":"short note"}\n` +
    "Rules:\n" +
    "- plate: uppercase A–Z and digits 0–9 only, NO spaces or dashes. If unreadable in every image, set plate to null.\n" +
    "- confidence: integer 0–100, YOUR confidence in the plate reading.\n" +
    "- make/color may be null when not visible.";

  const userContent: Array<
    { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
  > = [
    { type: "text", text: "Identify the license plate, make, and colour of the vehicle in these images." },
    ...dataUrls.map((u) => ({
      type: "image_url" as const,
      image_url: { url: u, detail: "high" as const },
    })),
  ];

  let resp;
  try {
    resp = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent as never },
      ],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0,
    });
  } catch (err) {
    console.error("[ai-fallback] OpenAI request failed:", (err as Error).message);
    return null;
  }

  const text = resp.choices[0]?.message?.content;
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as {
      plate?: unknown; make?: unknown; color?: unknown;
      confidence?: unknown; reasoning?: unknown;
    };
    const rawPlate = typeof parsed.plate === "string" ? parsed.plate : null;
    // Confidence must be a finite number in [0,100]; anything else (NaN,
    // Infinity, string, missing) becomes 0 so it can NEVER bypass the gate.
    const rawConf = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.max(0, Math.min(100, rawConf))
      : 0;
    return {
      plate: rawPlate
        ? rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, "") || null
        : null,
      make: typeof parsed.make === "string" ? parsed.make : null,
      color: typeof parsed.color === "string" ? parsed.color : null,
      confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch (err) {
    console.error("[ai-fallback] cannot parse AI response:", text, err);
    return null;
  }
}

// ── Public hooks (called from anpr.ts) ───────────────────────────────────────

/**
 * Hook into the ANPR denied path. Cheap no-op when disabled. Schedules an
 * async snapshot grab from the camera + state update; NEVER blocks the
 * caller (worker request stays fast). When threshold is reached, kicks off
 * the AI fallback in the background.
 */
export function recordFailure(
  camera: AiFallbackCamera,
  plate: string,
): void {
  if (!isEnabled()) return;

  void (async () => {
    const cap = await captureFromCamera(camera);
    if (!cap) return; // camera offline / unreachable — nothing we can do

    const now = Date.now();
    const cutoff = now - FAIL_RESET_MINUTES * 60_000;
    const s = state.get(camera.id) ?? { fails: [], inFlight: false };

    // Drop stale entries + don't pile up while AI is already running.
    if (s.inFlight) return;
    s.fails = s.fails.filter((f) => f.at >= cutoff);
    s.fails.push({ buffer: cap.buffer, mime: cap.mime, plate, at: now });
    if (s.fails.length > FAIL_THRESHOLD) {
      s.fails = s.fails.slice(-FAIL_THRESHOLD);
    }
    state.set(camera.id, s);

    if (s.fails.length >= FAIL_THRESHOLD) {
      s.inFlight = true;
      const fails = [...s.fails];
      void runAiFallback(camera, fails)
        .catch((err) => {
          console.error(`[ai-fallback] camera=${camera.id} unhandled error:`, err);
        })
        .finally(() => {
          const cur = state.get(camera.id);
          if (cur) {
            cur.inFlight = false;
            cur.fails = []; // reset after AI runs (whatever the outcome)
            state.set(camera.id, cur);
          }
        });
    }
  })().catch((err) => {
    console.error(`[ai-fallback] camera=${camera.id} top-level error:`, err);
  });
}

/** Allowed detection — reset the per-camera failure counter. */
export function recordSuccess(cameraId: string): void {
  if (!isEnabled()) return;
  const s = state.get(cameraId);
  if (s && !s.inFlight) {
    s.fails = [];
    state.set(cameraId, s);
  }
}

// ── Diagnostics (read-only snapshot for /diagnostics/system) ─────────────────

export interface AiFallbackStatus {
  enabled: boolean;
  has_api_key: boolean;
  model: string;
  threshold: number;
  reset_minutes: number;
  cameras_tracked: number;
  in_flight: number;
  last_activity_at: number | null;
}

let _lastActivityAt: number | null = null;
export function markActivity(): void {
  _lastActivityAt = Date.now();
}

export function getStatus(): AiFallbackStatus {
  let inFlight = 0;
  for (const s of state.values()) if (s.inFlight) inFlight++;
  return {
    enabled: isEnabled(),
    has_api_key: !!process.env.OPENAI_API_KEY,
    model: OPENAI_MODEL,
    threshold: FAIL_THRESHOLD,
    reset_minutes: FAIL_RESET_MINUTES,
    cameras_tracked: state.size,
    in_flight: inFlight,
    last_activity_at: _lastActivityAt,
  };
}

// ── Core AI fallback runner ──────────────────────────────────────────────────
async function runAiFallback(
  camera: AiFallbackCamera,
  fails: FailEntry[],
): Promise<void> {
  console.log(
    `[ai-fallback] camera=${camera.id} triggering AI on ${fails.length} snapshots`,
  );
  markActivity();

  // Persist snapshots to disk for the audit trail (best effort, in parallel).
  // We feed OpenAI directly from in-memory buffers, so a disk failure does
  // not block recognition — we just lose the saved images.
  const savedUrls = (
    await Promise.all(fails.map((f) => persistSnapshot(f.buffer, f.mime)))
  ).map((u) => u ?? null);

  const dataUrls = fails.map(
    (f) => `data:${f.mime};base64,${f.buffer.toString("base64")}`,
  );

  const verdict = await askOpenAi(dataUrls);
  if (!verdict) {
    console.warn(`[ai-fallback] camera=${camera.id} no verdict — skipping`);
    return;
  }

  console.log(
    `[ai-fallback] camera=${camera.id} verdict:`,
    JSON.stringify(verdict),
  );

  // Resolve villa scope for this camera's entrance.
  let villa_ids: string[] = [];
  if (camera.entrance_id) {
    const rows = await db
      .select({ villa_id: villaEntrancesTable.villa_id })
      .from(villaEntrancesTable)
      .where(eq(villaEntrancesTable.entrance_id, camera.entrance_id));
    villa_ids = rows.map((r) => r.villa_id);
  }

  type Outcome =
    | "no_plate"
    | "ignored_low_confidence"
    | "denied_unknown_vehicle"
    | "denied_no_villa_scope"
    | "denied_no_reservation"
    | "allowed_relay_ok"
    | "allowed_relay_failed";

  let outcome: Outcome = "ignored_low_confidence";
  let vehicle_id: string | null = null;
  let denial_code: string | null = null;
  let gate_error: string | null = null;
  let gate_success = false;
  let decision_reason: string | null = null;

  if (!verdict.plate) {
    outcome = "no_plate";
  } else if (verdict.confidence < AI_CONFIDENCE_MIN) {
    outcome = "ignored_low_confidence";
  } else if (villa_ids.length === 0) {
    outcome = "denied_no_villa_scope";
  } else {
    // Look up vehicle by AI plate (NO auto-create — same policy as anpr.ts).
    const existing = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.license_plate, verdict.plate))
      .limit(1);
    vehicle_id = existing[0]?.id ?? null;

    if (!vehicle_id) {
      outcome = "denied_unknown_vehicle";
    } else {
      const decision = await validateVehicleAccessMulti(vehicle_id, villa_ids);
      decision_reason = decision.reason ?? null;
      if (!decision.allowed) {
        outcome = "denied_no_reservation";
        denial_code = (decision as { denial_code?: string }).denial_code ?? null;
      } else {
        try {
          const adapter = createAdapter(camera);
          const gate = await adapter.open_gate();
          gate_success = gate.success;
          gate_error = gate.error ?? null;
          outcome = gate.success ? "allowed_relay_ok" : "allowed_relay_failed";
        } catch (err) {
          gate_error = (err as Error).message;
          outcome = "allowed_relay_failed";
        }
      }
    }
  }

  const allowedFinal = outcome === "allowed_relay_ok";
  const lastSavedUrl = savedUrls[savedUrls.length - 1] ?? null;

  // Persist as a regular access_events row so the UI / audit trail shows it.
  try {
    await db.insert(accessEventsTable).values({
      event_type: allowedFinal ? "entry" : "denied",
      status: allowedFinal ? "allowed" : "denied",
      confidence_score: verdict.confidence,
      vehicle_id,
      license_plate: verdict.plate ?? null,
      entrance_id: camera.entrance_id ?? null,
      camera_id: camera.id,
      snapshot_url: lastSavedUrl,
      notes: JSON.stringify({
        ai_fallback: true,
        ai_outcome: outcome,
        ai_plate: verdict.plate,
        ai_make: verdict.make,
        ai_color: verdict.color,
        ai_confidence: verdict.confidence,
        ai_reasoning: verdict.reasoning ?? null,
        ai_model: OPENAI_MODEL,
        ai_snapshots_count: fails.length,
        ai_snapshots: savedUrls,
        decision_reason,
        denial_code,
        gate_success,
        gate_error,
      }),
    });
  } catch (err) {
    console.error(`[ai-fallback] camera=${camera.id} failed to log event:`, err);
  }

  void eventBus.publish({
    event_type: allowedFinal ? "ai.fallback_allowed" : "ai.fallback_denied",
    severity:
      outcome === "allowed_relay_failed" ? "error"
      : outcome === "allowed_relay_ok" ? "info"
      : "warning",
    camera_id: camera.id,
    vehicle_id,
    source: "ai_fallback",
    payload: {
      outcome,
      ai_plate: verdict.plate,
      ai_make: verdict.make,
      ai_color: verdict.color,
      ai_confidence: verdict.confidence,
      ai_model: OPENAI_MODEL,
      snapshots_count: fails.length,
      snapshots: savedUrls,
      denial_code,
      gate_success,
      gate_error,
    },
  });
}
