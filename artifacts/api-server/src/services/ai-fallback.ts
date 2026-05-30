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
import { promises as fs, existsSync } from "fs";
import path from "path";
import * as crypto from "crypto";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  accessEventsTable,
  villaEntrancesTable,
  reservationsTable,
  reservationVehiclesTable,
  camerasTable,
} from "@workspace/db";
import { eq, and, inArray, lte, gte, ne } from "drizzle-orm";
import { validateVehicleAccessMulti } from "../lib/validation/reservation-validator";
import { createAdapter, type CameraRow } from "../lib/cameras/factory";
import { eventBus } from "../lib/events";
import { uploadsUrl } from "../lib/public-url";

// ── Tunables ─────────────────────────────────────────────────────────────────
const FAIL_THRESHOLD = 3;
// Window during which the 3 OCR failures must occur to qualify as "same
// vehicle waiting at the gate". Default 30s — a car physically standing
// in front of a barrier will produce several snapshots within this window.
// Override via AI_FALLBACK_RESET_SECONDS env var.
const FAIL_RESET_SECONDS = Math.max(
  5,
  Number(process.env.AI_FALLBACK_RESET_SECONDS) || 30,
);
// After an AI call actually runs for a camera, suppress further AI triggers
// for this many seconds. Prevents a vehicle lingering at the gate from
// re-invoking OpenAI every few seconds (token burn / rate limits). Only the
// AI path is throttled — normal OCR/relay flow is unaffected. Set to 0 to
// disable. Override via AI_FALLBACK_COOLDOWN_SECONDS env var.
const COOLDOWN_SECONDS = Math.max(
  0,
  Number(process.env.AI_FALLBACK_COOLDOWN_SECONDS ?? 60),
);
// Pre-AI guard: best raw OCR text from the 3 fails must match at least one
// currently-expected plate (permanent-access vehicles + vehicles tied to an
// active reservation for this camera's villa(s)) with similarity >= this
// percent. Below this the snapshots are almost certainly an unknown vehicle
// and we don't waste an OpenAI call. Override via AI_FALLBACK_MIN_SIMILARITY.
const MIN_SIMILARITY_PCT = Math.max(
  0,
  Math.min(100, Number(process.env.AI_FALLBACK_MIN_SIMILARITY) || 30),
);
const AI_CONFIDENCE_MIN = 70;
// Post-verdict fuzzy match: OpenAI occasionally drops/adds 1 char (e.g.
// "CA347MM" vs real "CA3477MM"). If exact lookup fails, try fuzzy match
// against the same expected-plates list used by the similarity gate.
// Default 75% requires high confidence — only forgives 1 char on ~7-char
// plates. Disable by setting AI_FALLBACK_FUZZY_MIN=0.
const AI_PLATE_FUZZY_MIN = Math.max(
  0,
  Math.min(100, Number(process.env.AI_FALLBACK_FUZZY_MIN) || 75),
);
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
  plate: string | null;     // legacy: normalised plate from a "denied" detection
  raw_text: string | null;  // best raw OCR text (any path) — used for pre-AI similarity gate
  at: number; // epoch ms
}

interface CameraState {
  fails: FailEntry[];
  inFlight: boolean;
  cooldownUntil?: number; // epoch ms — AI triggers suppressed until this time
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

// ── Kill switch (file-flag on disk, no DB) ───────────────────────────────────
// Owner-only runtime override: when /app/uploads/.ai_fallback_disabled exists
// (or its dev equivalent), isEnabled() returns false regardless of env. The
// file lives in the uploads_data Docker volume so it survives restarts. It is
// flipped via POST /diagnostics/ai-fallback/kill-switch (admin role) or by
// `touch /data/.ai_fallback_disabled` over SSH if the dashboard is down.
const KILL_SWITCH_FILE = path.resolve(UPLOADS_ROOT, ".ai_fallback_disabled");

function isEnvEnabled(): boolean {
  return process.env.AI_FALLBACK_ENABLED === "true";
}

function isKillSwitchEngaged(): boolean {
  // existsSync is cheap (single fs syscall) and isEnabled() is called only
  // on the AI path, which is gated behind 3 OCR failures — i.e. orders of
  // magnitude less frequent than the per-detection hot path.
  return existsSync(KILL_SWITCH_FILE);
}

function isEnabled(): boolean {
  return isEnvEnabled() && !isKillSwitchEngaged();
}

export async function setKillSwitch(engaged: boolean): Promise<void> {
  if (engaged) {
    await fs.mkdir(UPLOADS_ROOT, { recursive: true });
    await fs.writeFile(
      KILL_SWITCH_FILE,
      `disabled at ${new Date().toISOString()}\n`,
      "utf8",
    );
  } else {
    try {
      await fs.unlink(KILL_SWITCH_FILE);
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
}

export function getKillSwitchState(): {
  env_enabled: boolean;
  has_api_key: boolean;
  kill_switch_engaged: boolean;
  effective_enabled: boolean;
} {
  const env = isEnvEnabled();
  const kill = isKillSwitchEngaged();
  return {
    env_enabled: env,
    has_api_key: !!process.env.OPENAI_API_KEY,
    kill_switch_engaged: kill,
    effective_enabled: env && !kill,
  };
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
    // Be lenient with the data URL: some cameras (notably certain Hikvision
    // firmwares) return Content-Type with extra params like
    // "image/jpeg; charset=binary", producing data URLs of the shape
    // "data:image/jpeg; charset=binary;base64,XXXX" which the old strict
    // regex /^data:([^;]+);base64,(.+)$/ rejected. We now split on the
    // literal ";base64," sentinel and clean both halves separately.
    const dataUrl = result.snapshot_base64;
    const sep = ";base64,";
    const sepIdx = dataUrl.indexOf(sep);
    if (!dataUrl.startsWith("data:") || sepIdx === -1) {
      console.warn(`[ai-fallback] camera=${camera.id} bad snapshot data URL`);
      return null;
    }
    // Everything between "data:" and ";base64," is the MIME header; take
    // only the leading "type/subtype" portion (strip any params after first ";").
    const mimeHeader = dataUrl.slice(5, sepIdx);
    const mime = (mimeHeader.split(";")[0] || "image/jpeg").trim() || "image/jpeg";
    // base64 payloads may contain whitespace/newlines — strip them so
    // Buffer.from doesn't silently truncate.
    const base64Payload = dataUrl.slice(sepIdx + sep.length).replace(/\s+/g, "");
    const buffer = Buffer.from(base64Payload, "base64");
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
  plate: string | null,
  raw_text?: string | null,
): void {
  if (!isEnabled()) return;

  void (async () => {
    const cap = await captureFromCamera(camera);
    if (!cap) return; // camera offline / unreachable — nothing we can do

    const now = Date.now();
    const cutoff = now - FAIL_RESET_SECONDS * 1000;
    const s = state.get(camera.id) ?? { fails: [], inFlight: false };

    // Drop stale entries + don't pile up while AI is already running.
    if (s.inFlight) return;
    // Post-run cooldown: a vehicle lingering at the gate keeps producing
    // fails; without this it would re-invoke OpenAI every few seconds.
    if (s.cooldownUntil && now < s.cooldownUntil) return;
    s.fails = s.fails.filter((f) => f.at >= cutoff);
    s.fails.push({
      buffer: cap.buffer,
      mime: cap.mime,
      plate,
      raw_text: raw_text ?? plate, // fallback to plate when no separate raw OCR text
      at: now,
    });
    if (s.fails.length > FAIL_THRESHOLD) {
      s.fails = s.fails.slice(-FAIL_THRESHOLD);
    }
    state.set(camera.id, s);

    if (s.fails.length >= FAIL_THRESHOLD) {
      // Claim the trigger slot BEFORE any await so a second concurrent fail
      // for the same camera cannot also invoke AI. The slot is released in
      // .finally() below (whether the gate passes or AI runs).
      s.inFlight = true;
      state.set(camera.id, s);
      const fails = [...s.fails];
      let aiRan = false;

      void (async () => {
        // Pre-AI similarity gate: only invoke OpenAI when at least one
        // buffered raw read is plausibly close to an expected plate. This
        // prevents wasting tokens on random unknown vehicles passing by.
        const gate = await passesSimilarityGate(camera, fails);
        if (!gate.passed) {
          console.log(
            `[ai-fallback] camera=${camera.id} similarity gate failed ` +
              `(best=${gate.bestPct}% < ${MIN_SIMILARITY_PCT}% for ` +
              `"${gate.bestRaw ?? ""}" vs "${gate.bestExpected ?? ""}") — skipping AI`,
          );
          return;
        }
        console.log(
          `[ai-fallback] camera=${camera.id} similarity gate passed ` +
            `(best=${gate.bestPct}% "${gate.bestRaw}" ≈ "${gate.bestExpected}") — invoking AI`,
        );
        aiRan = true;
        await runAiFallback(camera, fails);
      })()
        .catch((err) => {
          console.error(`[ai-fallback] camera=${camera.id} unhandled error:`, err);
        })
        .finally(() => {
          const cur = state.get(camera.id);
          if (cur) {
            cur.inFlight = false;
            cur.fails = []; // reset whether gate passed/failed/AI ran
            // Only start the cooldown when an AI call actually fired, so a
            // failed similarity gate (no token cost) does not delay a real
            // vehicle that arrives moments later.
            if (aiRan && COOLDOWN_SECONDS > 0) {
              cur.cooldownUntil = Date.now() + COOLDOWN_SECONDS * 1000;
            }
            state.set(camera.id, cur);
          }
        });
    }
  })().catch((err) => {
    console.error(`[ai-fallback] camera=${camera.id} top-level error:`, err);
  });
}

// ── Pre-AI similarity gate ───────────────────────────────────────────────────
// Compare the buffered raw OCR reads against the set of currently-expected
// plates for this camera's villa(s): permanent-access vehicles + vehicles
// tied to a reservation whose window contains "now". Returns the best match
// so the caller can decide whether to invoke OpenAI.

function normaliseForCompare(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function plateSimilarityPct(a: string, b: string): number {
  // Python SequenceMatcher.ratio() equivalent on uppercase alnum strings.
  // Same semantics as `similarityPct` in anpr.ts; duplicated here only to
  // avoid a cross-service import cycle. Always returns a value in [0, 100].
  const A = normaliseForCompare(a);
  const B = normaliseForCompare(b);
  const total = A.length + B.length;
  if (total === 0) return 100;
  if (A.length === 0 || B.length === 0) return 0;
  // Greedy longest-common-substring count (depth-bounded recursion is fine
  // for plate-length inputs ≤ ~12 chars).
  const lcsBlocks = (
    s1: string, lo1: number, hi1: number,
    s2: string, lo2: number, hi2: number,
  ): number => {
    let bestI = lo1;
    let bestJ = lo2;
    let bestK = 0;
    const j2len = new Map<number, number>();
    for (let i = lo1; i < hi1; i++) {
      const newJ2len = new Map<number, number>();
      for (let j = lo2; j < hi2; j++) {
        if (s1[i] === s2[j]) {
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newJ2len.set(j, k);
          if (k > bestK) {
            bestI = i - k + 1;
            bestJ = j - k + 1;
            bestK = k;
          }
        }
      }
      j2len.clear();
      for (const [k, v] of newJ2len) j2len.set(k, v);
    }
    if (bestK === 0) return 0;
    return (
      bestK +
      lcsBlocks(s1, lo1, bestI, s2, lo2, bestJ) +
      lcsBlocks(s1, bestI + bestK, hi1, s2, bestJ + bestK, hi2)
    );
  };
  const m = lcsBlocks(A, 0, A.length, B, 0, B.length);
  const pct = (2 * m) / total * 100;
  // Clamp to [0, 100] (cannot exceed in theory; defensive against rounding).
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

async function getExpectedPlatesForCamera(
  camera: AiFallbackCamera,
): Promise<string[]> {
  // Resolve villa scope from the camera's entrance.
  let entranceId = camera.entrance_id;
  if (!entranceId) {
    const rows = await db
      .select({ entrance_id: camerasTable.entrance_id })
      .from(camerasTable)
      .where(eq(camerasTable.id, camera.id))
      .limit(1);
    entranceId = rows[0]?.entrance_id ?? null;
  }
  let villaIds: string[] = [];
  if (entranceId) {
    const rows = await db
      .select({ villa_id: villaEntrancesTable.villa_id })
      .from(villaEntrancesTable)
      .where(eq(villaEntrancesTable.entrance_id, entranceId));
    villaIds = rows.map((r) => r.villa_id);
  }

  const plates = new Set<string>();

  // Permanent-access vehicles (staff/owner/maintenance) — global scope,
  // always allowed regardless of camera/villa.
  const permRows = await db
    .select({ plate: vehiclesTable.license_plate })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.access_type, "permanent"),
        ne(vehiclesTable.status, "blacklisted"),
      ),
    );
  for (const r of permRows) if (r.plate) plates.add(r.plate);

  // Vehicles tied to a reservation whose access window contains "now",
  // scoped to the camera's villa(s). Window is [check_in − 1h, check_out +
  // 1h] to match the validator's grace period (CHECKIN_GRACE_MS /
  // CHECKOUT_GRACE_MS in reservation-validator.ts). Status must be active
  // OR upcoming (upcoming reservations enter their grace before the start
  // status flip; cancelled/completed are excluded).
  if (villaIds.length > 0) {
    const GRACE_MS = 60 * 60 * 1000; // 1h, mirrors validator
    const checkInBoundary = new Date(Date.now() + GRACE_MS);   // check_in <= now + 1h
    const checkOutBoundary = new Date(Date.now() - GRACE_MS);  // check_out >= now - 1h
    const resRows = await db
      .select({ plate: vehiclesTable.license_plate })
      .from(reservationVehiclesTable)
      .innerJoin(
        reservationsTable,
        eq(reservationVehiclesTable.reservation_id, reservationsTable.id),
      )
      .innerJoin(
        vehiclesTable,
        eq(reservationVehiclesTable.vehicle_id, vehiclesTable.id),
      )
      .where(
        and(
          inArray(reservationsTable.villa_id, villaIds),
          ne(vehiclesTable.status, "blacklisted"),
          inArray(reservationsTable.status, ["active", "upcoming"]),
          lte(reservationsTable.check_in, checkInBoundary),
          gte(reservationsTable.check_out, checkOutBoundary),
        ),
      );
    for (const r of resRows) if (r.plate) plates.add(r.plate);
  }

  return [...plates];
}

interface SimilarityGateResult {
  passed: boolean;
  bestPct: number;
  bestRaw: string | null;
  bestExpected: string | null;
}

async function passesSimilarityGate(
  camera: AiFallbackCamera,
  fails: FailEntry[],
): Promise<SimilarityGateResult> {
  // No threshold configured → always pass (back-compat / opt-out).
  if (MIN_SIMILARITY_PCT <= 0) {
    return { passed: true, bestPct: 100, bestRaw: null, bestExpected: null };
  }
  const expected = await getExpectedPlatesForCamera(camera);
  if (expected.length === 0) {
    // Nothing to compare against — no point invoking AI for a villa with no
    // active expectations. Skip and save tokens.
    return { passed: false, bestPct: 0, bestRaw: null, bestExpected: null };
  }
  let bestPct = 0;
  let bestRaw: string | null = null;
  let bestExpected: string | null = null;
  for (const f of fails) {
    const raw = f.raw_text;
    if (!raw) continue;
    for (const exp of expected) {
      const pct = plateSimilarityPct(raw, exp);
      if (pct > bestPct) {
        bestPct = pct;
        bestRaw = raw;
        bestExpected = exp;
      }
    }
  }
  return {
    passed: bestPct >= MIN_SIMILARITY_PCT,
    bestPct,
    bestRaw,
    bestExpected,
  };
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
  env_enabled: boolean;
  kill_switch_engaged: boolean;
  has_api_key: boolean;
  model: string;
  threshold: number;
  reset_minutes: number;       // kept for backward-compat with existing UI
  reset_seconds: number;
  min_similarity_pct: number;
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
    env_enabled: isEnvEnabled(),
    kill_switch_engaged: isKillSwitchEngaged(),
    has_api_key: !!process.env.OPENAI_API_KEY,
    model: OPENAI_MODEL,
    threshold: FAIL_THRESHOLD,
    reset_minutes: Math.round((FAIL_RESET_SECONDS / 60) * 10) / 10,
    reset_seconds: FAIL_RESET_SECONDS,
    min_similarity_pct: MIN_SIMILARITY_PCT,
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

    // Fuzzy fallback: OpenAI can drop/add 1 char. If exact lookup failed,
    // compare verdict.plate against the same expected-plates list used by
    // the similarity gate, and adopt the best match if it clears the
    // high-confidence fuzzy threshold. This is scoped to the camera's
    // villas, so it cannot match an unrelated plate.
    if (!vehicle_id && AI_PLATE_FUZZY_MIN > 0) {
      const expected = await getExpectedPlatesForCamera(camera);
      let bestPlate: string | null = null;
      let bestPct = 0;
      for (const p of expected) {
        const pct = plateSimilarityPct(verdict.plate, p);
        if (pct > bestPct) { bestPct = pct; bestPlate = p; }
      }
      if (bestPlate && bestPct >= AI_PLATE_FUZZY_MIN) {
        console.log(
          `[ai-fallback] camera=${camera.id} fuzzy-matched AI verdict ` +
            `"${verdict.plate}" → "${bestPlate}" (${bestPct}%)`,
        );
        const fuzzy = await db
          .select({ id: vehiclesTable.id })
          .from(vehiclesTable)
          .where(eq(vehiclesTable.license_plate, bestPlate))
          .limit(1);
        vehicle_id = fuzzy[0]?.id ?? null;
        if (vehicle_id) verdict.plate = bestPlate;
      } else if (bestPlate) {
        console.log(
          `[ai-fallback] camera=${camera.id} AI verdict "${verdict.plate}" ` +
            `fuzzy best="${bestPlate}" ${bestPct}% < ${AI_PLATE_FUZZY_MIN}% — rejecting`,
        );
      }
    }

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
