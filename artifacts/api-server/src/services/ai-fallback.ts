/**
 * AI fallback after N consecutive ANPR failures.
 *
 * ADDITIVE / OPT-IN: gated by env AI_FALLBACK_ENABLED=true. When OFF (default)
 * the exported hooks are no-ops, so OCR / YOLO / worker / relay / cooldown /
 * fuzzy / validator behaviour is completely unchanged.
 *
 * Flow (per camera):
 *   1. anpr.ts calls recordFailure() on every "denied" detection.
 *   2. After FAIL_THRESHOLD failures within FAIL_RESET_MINUTES we send the
 *      collected snapshots to OpenAI vision (gpt-4o-mini) and ask for the
 *      plate + make + colour + self-confidence.
 *   3. If the AI confidence is high enough AND the plate corresponds to a
 *      registered vehicle with an active reservation for one of this
 *      entrance's villas, we open the gate via the existing CameraAdapter
 *      (same path as the normal allowed flow). We DO NOT auto-create
 *      vehicles (Vehicles page remains the source of truth).
 *   4. The decision is logged as a regular access_events row with
 *      notes.ai_fallback=true so the UI / audit trail can show it.
 *   5. The per-camera counter resets after AI runs, after any allowed
 *      detection, and after FAIL_RESET_MINUTES of inactivity.
 *
 * State is in-memory (single-process server) — restart clears counters,
 * which is fine: the worst case is that the next 3 fails re-trigger AI.
 */

import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
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

// ── Tunables ─────────────────────────────────────────────────────────────────
const FAIL_THRESHOLD = 3;
const FAIL_RESET_MINUTES = 10;
const AI_CONFIDENCE_MIN = 70;
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 25_000;

// ── Types ────────────────────────────────────────────────────────────────────
export interface AiFallbackCamera extends CameraRow {
  entrance_id?: string | null;
}

interface FailEntry {
  snapshotUrl: string;
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

// ── Snapshot URL → local file path ───────────────────────────────────────────
function snapshotUrlToPath(url: string): string {
  // Accepts both root-relative ("/api/uploads/snapshots/...") and absolute
  // ("http://host:8080/api/uploads/snapshots/...") URLs.
  const m = url.match(/\/api\/uploads\/(.+)$/);
  const rel = m ? m[1] : url.replace(/^\/+/, "");
  return path.resolve(process.cwd(), "uploads", rel);
}

async function imageToDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mime =
      ext === ".png" ? "image/png"
      : ext === ".webp" ? "image/webp"
      : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.warn(`[ai-fallback] cannot read snapshot ${absPath}:`, (err as Error).message);
    return null;
  }
}

// ── OpenAI call ──────────────────────────────────────────────────────────────
async function askOpenAi(snapshotUrls: string[]): Promise<AiVerdict | null> {
  const client = getClient();
  if (!client) {
    console.warn("[ai-fallback] OPENAI_API_KEY not set — skipping AI call");
    return null;
  }

  const dataUrls = (
    await Promise.all(snapshotUrls.map((u) => imageToDataUrl(snapshotUrlToPath(u))))
  ).filter((x): x is string => x !== null);

  if (dataUrls.length === 0) {
    console.warn("[ai-fallback] no readable snapshots to analyse");
    return null;
  }

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
    return {
      plate: rawPlate
        ? rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, "") || null
        : null,
      make: typeof parsed.make === "string" ? parsed.make : null,
      color: typeof parsed.color === "string" ? parsed.color : null,
      confidence: Number(parsed.confidence ?? 0),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch (err) {
    console.error("[ai-fallback] cannot parse AI response:", text, err);
    return null;
  }
}

// ── Public hooks (called from anpr.ts) ───────────────────────────────────────

/**
 * Hook into the ANPR denied path. Cheap no-op when disabled or when there
 * is no snapshot. Fires the AI asynchronously after the Nth fail — does
 * NOT block the caller. Safe to call from a fire-and-forget context.
 */
export function recordFailure(
  camera: AiFallbackCamera,
  snapshotUrl: string | null | undefined,
  plate: string,
): void {
  if (!isEnabled()) return;
  if (!snapshotUrl) return;

  const now = Date.now();
  const cutoff = now - FAIL_RESET_MINUTES * 60_000;

  const s = state.get(camera.id) ?? { fails: [], inFlight: false };
  s.fails = s.fails.filter((f) => f.at >= cutoff);
  s.fails.push({ snapshotUrl, plate, at: now });
  if (s.fails.length > FAIL_THRESHOLD) {
    s.fails = s.fails.slice(-FAIL_THRESHOLD);
  }
  state.set(camera.id, s);

  if (s.fails.length >= FAIL_THRESHOLD && !s.inFlight) {
    s.inFlight = true;
    const snapshots = s.fails.map((f) => f.snapshotUrl);
    // Fire-and-forget — must not block the worker response.
    void runAiFallback(camera, snapshots)
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

// ── Core AI fallback runner ──────────────────────────────────────────────────
async function runAiFallback(
  camera: AiFallbackCamera,
  snapshots: string[],
): Promise<void> {
  console.log(
    `[ai-fallback] camera=${camera.id} triggering AI on ${snapshots.length} snapshots`,
  );

  const verdict = await askOpenAi(snapshots);
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
  const lastSnapshot = snapshots[snapshots.length - 1] ?? null;

  // Persist as a regular access_events row so the UI/audit trail shows it.
  try {
    await db.insert(accessEventsTable).values({
      event_type: allowedFinal ? "entry" : "denied",
      status: allowedFinal ? "allowed" : "denied",
      confidence_score: verdict.confidence,
      vehicle_id,
      license_plate: verdict.plate ?? null,
      entrance_id: camera.entrance_id ?? null,
      camera_id: camera.id,
      snapshot_url: lastSnapshot,
      notes: JSON.stringify({
        ai_fallback: true,
        ai_outcome: outcome,
        ai_plate: verdict.plate,
        ai_make: verdict.make,
        ai_color: verdict.color,
        ai_confidence: verdict.confidence,
        ai_reasoning: verdict.reasoning ?? null,
        ai_model: OPENAI_MODEL,
        ai_snapshots_count: snapshots.length,
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
      snapshots_count: snapshots.length,
      denial_code,
      gate_success,
      gate_error,
    },
  });
}
