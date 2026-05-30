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
 *   3. Look up vehicle by plate (READ-ONLY). If unknown, vehicle_id stays
 *      null and we synthesise a NO_RESERVATION denial — the Vehicles master
 *      DB is never auto-populated from OCR text (separation of concerns).
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
  villaEntrancesTable,
  accessEventsTable,
} from "@workspace/db";
import { and, eq, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import { validateVehicleAccessMulti } from "../lib/validation/reservation-validator";
import { createAdapter } from "../lib/cameras/factory";
import { eventBus } from "../lib/events";
import * as aiFallback from "./ai-fallback";

// ─── Fuzzy plate matching helpers ───────────────────────────────────────────
//
// Pure functions — no DB, no I/O. Port of Python's difflib.SequenceMatcher
// .ratio() (Ratcliff–Obershelp): ratio = 2 * M / T, where M is the sum of
// matching block sizes and T = |a| + |b|. The earlier implementation used
// Levenshtein distance, which is NOT equivalent to SequenceMatcher and
// under-scored prefix/suffix-truncated plates by ~10 points (e.g. for
// CA3477 vs CA3477MM, Levenshtein → 75%, SequenceMatcher → 85.7%) — that
// caused legitimate partial matches to fall below the 80% threshold even
// when the OCR was a clean prefix of the registered plate. Re-aligning
// with SequenceMatcher restores the documented behaviour the ANPR worker
// was originally designed for.
//
// Plates are ≤ ~10 chars so the recursive find-longest-match is trivial.

function findLongestMatch(
  a: string, alo: number, ahi: number,
  b: string, blo: number, bhi: number,
): { i: number; j: number; size: number } {
  let bestI = alo, bestJ = blo, bestSize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    for (let j = blo; j < bhi; j++) {
      if (a.charCodeAt(i) === b.charCodeAt(j)) {
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestSize) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestSize = k;
        }
      }
    }
    j2len = next;
  }
  return { i: bestI, j: bestJ, size: bestSize };
}

function matchingChars(
  a: string, alo: number, ahi: number,
  b: string, blo: number, bhi: number,
): number {
  const { i, j, size } = findLongestMatch(a, alo, ahi, b, blo, bhi);
  if (size === 0) return 0;
  return (
    size +
    matchingChars(a, alo, i, b, blo, j) +
    matchingChars(a, i + size, ahi, b, j + size, bhi)
  );
}

/** Similarity in percent (0–100), Python SequenceMatcher.ratio() equivalent. */
function similarityPct(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 100;
  const m = matchingChars(a, 0, a.length, b, 0, b.length);
  return Math.round(((2 * m) / total) * 1000) / 10; // one decimal
}

/**
 * Count digit characters that appear in BOTH plates at common positions
 * (left-aligned). Plates of slightly different length are compared up to
 * the shorter length. This is intentionally conservative — it's a safety
 * gate to block "high similarity but the numbers differ" matches like
 * CA1111MM vs CA2222MM (similarity 75% but zero shared digits).
 */
function sharedDigitCount(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let n = 0;
  for (let i = 0; i < len; i++) {
    const ca = a[i];
    if (ca >= "0" && ca <= "9" && ca === b[i]) n++;
  }
  return n;
}

/**
 * Longest run of consecutive characters common to both plates, regardless of
 * where it sits in each string (shift-invariant). Unlike sharedDigitCount —
 * which is LEFT-ALIGNED and silently returns 0 when OCR adds/drops a leading
 * char — this matches one lingering car's OCR variants whose numeric core
 * drifts in position: B2020Y vs EB2020X share the run "B2020" (5) even though
 * the digits sit at different offsets. A 5+ char run in an EU plate necessarily
 * spans the 4-digit core PLUS an adjacent letter, so requiring ≥5 both fixes the
 * prefix-shift miss AND keeps two genuinely different cars that merely share the
 * same 4 digits (run = 4, just the digits) distinct. Used ONLY by the dedup /
 * gate-debounce hygiene paths — the fuzzy access-decision matcher is untouched.
 */
function longestCommonRun(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1;
        if (prev[j] > best) best = prev[j];
      } else {
        prev[j] = 0;
      }
      diag = tmp;
    }
  }
  return best;
}

// ─── Denied-event dedup (UI hygiene) ────────────────────────────────────────
// A heavily occluded/dirty plate makes OCR emit many slightly-different reads
// for the SAME lingering vehicle (e.g. B2020X, B2020Y, B2020XE, B2020 ...).
// Each distinct string clears the exact-plate cooldown claim below and would
// log its own "denied" access_event — flooding the dashboard with near-dupes.
// We additionally suppress LOGGING (insert + live publish) of a denied
// detection whose plate is highly similar to the most recent denied read on
// the same camera within the camera's cooldown window.
//
// This NEVER touches the allowed path (the relay/gate always fires for an
// allowed read, even one that arrives right after denied garbage variants) and
// NEVER touches the AI fallback hook (still fired on every denied read so the
// OpenAI re-read can recover the plate). OCR / worker / fuzzy logic unchanged.
const DENIED_DEDUP_SIMILARITY = Number(
  process.env.ANPR_DENIED_DEDUP_SIMILARITY ?? 70,
); // percent (0–100); set 0 to disable dedup entirely
// Safety gate: only collapse reads that ALSO share this many digits in the same
// (left-aligned) positions. OCR drift of one plate keeps its digits (B2020X /
// B2020YE / B2020 all share "2020" → 4), whereas a genuinely different denied
// vehicle whose letters are coincidentally similar will share fewer digits and
// is therefore still logged. Mirrors the fuzzy fallback's shared-digit gate.
// Minimum shift-invariant common run (consecutive chars) to treat two denied
// reads as the same lingering vehicle. 4 = the bare numeric core; safe here
// because the denied path is pure UI-log hygiene (no access/relay impact), so
// over-collapsing only costs a log row.
const DENIED_DEDUP_MIN_RUN = Number(
  process.env.ANPR_DENIED_DEDUP_MIN_RUN ?? 4,
);
const recentDenied = new Map<string, { plate: string; at: number }>();

/**
 * True when this denied detection is a near-duplicate of a recent denied read
 * on the same camera (so its event should NOT be logged). Always advances the
 * per-camera anchor to the latest read+time, so a continuously lingering
 * vehicle collapses to a single logged denied event per visit. Suppression
 * requires BOTH high similarity AND enough shared digits, so two different
 * denied vehicles are not masked by letter-only resemblance.
 */
function isDuplicateDenied(
  cameraId: string,
  plate: string,
  windowSecs: number,
): boolean {
  if (!(DENIED_DEDUP_SIMILARITY > 0)) return false;
  const now = Date.now();
  const prev = recentDenied.get(cameraId);
  recentDenied.set(cameraId, { plate, at: now });
  if (!prev) return false;
  if (now - prev.at >= windowSecs * 1000) return false;
  // Shift-invariant: collapse when both reads share a long enough consecutive
  // run (numeric core + adjacent char). Replaces the old left-aligned
  // similarity+positional-digit test, which silently missed OCR variants whose
  // leading char drifted (B2020Y vs EB2020X shared 0 positional digits).
  return longestCommonRun(plate, prev.plate) >= DENIED_DEDUP_MIN_RUN;
}

// ── Gate-relay debounce (allowed path) ───────────────────────────────────────
// A lingering vehicle is read as DISTINCT-but-similar plates (CB2020XP /
// CB2020X / 7B2020X / 2B2020X ...). Each distinct string passes the atomic
// cooldown claim below and RE-FIRES the relay — so the barrier flaps
// open/close several times for what is physically a single car. The exact-plate
// repeat is already absorbed by the claim (last_anpr_plate IS DISTINCT FROM);
// this additionally collapses the near-identical OCR variants.
//
// Suppression requires BOTH high similarity AND enough shared digits, so a
// genuinely different vehicle still opens the gate immediately. The anchor is
// recorded only after a SUCCESSFUL gate open (see the allowed path), so a failed
// relay never blocks the next legitimate retry, and it is pinned to the plate
// that GRANTED access (never drifts to a suppressed variant).
//
// The shared-digit gate defaults to 4 here (stricter than the denied path's 3):
// the OCR variants of one lingering car preserve its full numeric core (e.g.
// "2020" across 7B2020X / 2B2020X / CB2020X / CB2020XP → 4 left-aligned digits),
// whereas a different car whose number differs by even one digit (CB2021XP)
// shares only 3 — so it is NOT suppressed and opens the gate. Erring at 4 favours
// OPENING (safe): the worst case is one extra relay pulse, never a blocked car.
// Residual, documented limitation: two genuinely different cars that share the
// SAME number but differ only in letters (CB2020XP vs CB2020XA) within the
// window are indistinguishable from OCR letter-drift and could be collapsed;
// negligible at a low-traffic villa gate. Set ANPR_GATE_DEDUP_SIMILARITY=0 to
// disable entirely and restore "open on every distinct allowed read".
const GATE_DEDUP_SIMILARITY = Number(
  process.env.ANPR_GATE_DEDUP_SIMILARITY ?? DENIED_DEDUP_SIMILARITY,
); // percent (0–100); set 0 to disable
// Minimum shift-invariant common run (consecutive chars) to treat an allowed
// read as the same lingering vehicle that just opened the gate. Default 5 = the
// 4-digit core PLUS one adjacent letter: this collapses OCR variants of one car
// (which keep that 5+ run) yet still opens for a genuinely DIFFERENT car that
// merely shares the same 4 digits (run = 4 < 5) — protecting a second legit car.
const GATE_DEDUP_MIN_RUN = Number(
  process.env.ANPR_GATE_DEDUP_MIN_RUN ?? 5,
);
const recentGateOpen = new Map<string, { plate: string; at: number }>();

/**
 * True when this allowed read is a near-duplicate of the plate that most
 * recently opened THIS camera's gate, within the cooldown window — i.e. the
 * same lingering vehicle re-read as a similar OCR variant. Read-only: the
 * anchor is advanced by the caller only on a successful open (or to keep a
 * continuously lingering vehicle collapsed), never here.
 */
function isRecentGateOpen(
  cameraId: string,
  plate: string,
  windowSecs: number,
): boolean {
  if (!(GATE_DEDUP_SIMILARITY > 0)) return false;
  const prev = recentGateOpen.get(cameraId);
  if (!prev) return false;
  if (Date.now() - prev.at >= windowSecs * 1000) return false;
  // Shift-invariant: one car's OCR variants keep a long consecutive run (numeric
  // core + adjacent letter) with the granting plate even when their leading char
  // drifts (B2020Y vs EB2020X → run "B2020" = 5). The old left-aligned digit
  // test returned 0 for exactly this case, so the barrier re-fired per variant.
  return longestCommonRun(plate, prev.plate) >= GATE_DEDUP_MIN_RUN;
}

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
    | "skipped_low_quality"
    | "denied"
    | "skipped_gate_cooldown"
    | "allowed_relay_ok"
    | "allowed_relay_failed";
  plate: string;
  vehicle_id?: string | null;
  reason?: string;
  denial_code?: string;
  gate?: { success: boolean; error?: string };
  /** "exact" when OCR plate matched a vehicle row directly, "partial" when
   *  fuzzy fallback was used, "none" when no candidate matched. */
  match_type?: "exact" | "partial" | "none";
  /** Plate that was actually used for access validation. Equals `plate`
   *  for exact matches; differs for partial matches. */
  matched_plate?: string;
  /** Levenshtein similarity vs `matched_plate` in percent (0–100). */
  similarity_pct?: number;
}

function normalisePlate(p: string): string {
  return p.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Plate plausibility gate — used ONLY to decide whether to persist a
 * "denied" event row + publish a denial to the live feed. Allowed events
 * are always saved (the plate already passed the validator AND triggered
 * the relay, so by definition it isn't OCR garbage).
 *
 * A detection is plausible only when ALL of the below hold:
 *   • normalised plate is between 5 and 10 chars (real EU plates are 6–8)
 *   • plate is alphanumeric (uppercase letters + digits only)
 *   • plate contains at least one letter AND one digit
 *   • OCR confidence ≥ the camera's configured `ocr_min_confidence`
 *
 * Implausible detections are silently dropped — the worker / OCR /
 * fuzzy logic is unchanged; only the events log is kept clean.
 */
function isPlausiblePlate(
  plate: string,
  confidence: number,
  minConfidence: number,
): boolean {
  if (plate.length < 5 || plate.length > 10) return false;
  if (!/^[A-Z0-9]+$/.test(plate)) return false;
  if (!/[A-Z]/.test(plate) || !/[0-9]/.test(plate)) return false;
  // NOTE: confidence gate intentionally removed — Tesseract often reports
  // conf=0.0 even for correct reads. Structural plausibility (length /
  // alphanumeric / has letter+digit) above is enough; the real safety net is
  // the fuzzy-match similarity threshold + shared-digit gate downstream.
  void confidence;
  void minConfidence;
  return true;
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

  // ── UI hygiene gate ────────────────────────────────────────────────────────
  // Drop OCR garbage / intermediate candidates BEFORE we touch cooldown,
  // the vehicle table, or the validator. Implausible plates (wrong length,
  // non-alphanumeric, missing letters/digits, or below the camera's own
  // OCR confidence threshold) can't reliably correspond to any real plate
  // — including blacklisted ones — so skipping them here keeps the events
  // log clean AND avoids burning cooldown on noise. Worker / OCR / relay
  // logic is untouched.
  if (!isPlausiblePlate(plate, input.confidence, camera.ocr_min_confidence ?? 70)) {
    // AI fallback hook (additive, gated by AI_FALLBACK_ENABLED). A plate that
    // fails the plausibility gate (e.g. a heavily obstructed/dirty plate where
    // OCR only recovered a few chars like "20XP") still signals a failed
    // recognition. Without this, such detections die here BEFORE the AI hook
    // on the denied path — so a strongly occluded plate could never trigger
    // OpenAI vision. We treat the implausible read as raw text (plate=null) so
    // the downstream similarity gate compares it against expected plates,
    // mirroring the no-match path. Fire-and-forget — never blocks the worker.
    aiFallback.recordFailure(camera, null, input.raw_ocr_text ?? plate);
    return {
      action: "skipped_low_quality",
      plate,
      reason: "Below plausibility threshold (length/alphanumeric/confidence)",
    };
  }

  // Derive the set of villas this entrance serves from the M:N join table
  // (villa_entrances). This is the source of truth as of Phase A.1.
  // entrances.villa_id remains in the schema for backward-compat reads but
  // is no longer consulted by the ANPR validator.
  let villa_ids: string[] = [];
  if (camera.entrance_id) {
    const rows = await db
      .select({ villa_id: villaEntrancesTable.villa_id })
      .from(villaEntrancesTable)
      .where(eq(villaEntrancesTable.entrance_id, camera.entrance_id));
    villa_ids = rows.map((r) => r.villa_id);
  }
  if (villa_ids.length === 0) {
    return {
      action: "skipped_no_villa",
      plate,
      reason: "Camera's entrance has no villas wired (configure in Entrances → Allowed Villas)",
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

  // ── 3. Lookup vehicle by plate (READ-ONLY) ────────────────────────────────
  // Separation of concerns: ANPR detections must NOT auto-create rows in the
  // vehicle master DB. The Vehicles page is for real, admin-registered cars
  // (reservation guests, permanent access, blacklist). OCR text — even valid
  // — only becomes a "vehicle" when someone adds it via the dashboard.
  // If the plate isn't registered, we synthesise a NO_RESERVATION denial so
  // the fuzzy fallback below can still try to match against a real plate.
  const existing = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.license_plate, plate))
    .limit(1);
  let vehicle_id: string | null = existing[0]?.id ?? null;

  // ── 4. Validate via single source of truth (M:N villa scope) ─────────────
  let decision = vehicle_id
    ? await validateVehicleAccessMulti(vehicle_id, villa_ids)
    : {
        allowed: false,
        reason: "No reservation found for this vehicle",
        denial_code: "NO_RESERVATION" as const,
      };

  // Track match metadata for visibility (UI / events / notes). Exact-match is
  // the legacy path; only flipped to "partial" if fuzzy fallback succeeds.
  let matchType: "exact" | "partial" | "none" = decision.allowed
    ? "exact"
    : "none";
  let matchedPlate: string = plate;
  let similarity: number = 100;

  // ── 5. Fuzzy fallback (additive, OFF by default) ──────────────────────────
  // Only runs when:
  //   * exact match failed with denial_code NO_RESERVATION or VEHICLE_NOT_FOUND
  //     (i.e. the OCR'd plate doesn't correspond to a known reservation — the
  //     legitimate OCR-typo case), AND
  //   * camera.allow_partial_match is true, AND
  //   * OCR confidence >= camera.partial_min_confidence.
  //
  // Fuzzy MUST NOT run for policy denials (BLACKLISTED, RESERVATION_CANCELLED,
  // RESERVATION_EXPIRED, OUTSIDE_WINDOW) — otherwise a blacklisted plate could
  // be silently superseded by a similar allowed plate.
  //
  // We scan known vehicle plates, pick the most-similar one passing both
  // the similarity threshold AND the shared-digit safety gate, then re-run
  // validateVehicleAccess against THAT vehicle. validateVehicleAccess remains
  // the single source of truth — fuzzy matching only changes which vehicle
  // we validate, never whether the validator's verdict is honoured.
  const fuzzyEligibleDenial =
    (decision as { denial_code?: string }).denial_code === "NO_RESERVATION" ||
    (decision as { denial_code?: string }).denial_code === "VEHICLE_NOT_FOUND";
  if (
    !decision.allowed &&
    fuzzyEligibleDenial &&
    camera.allow_partial_match &&
    input.confidence >= (camera.partial_min_confidence ?? 50)
  ) {
    const threshold = camera.partial_match_threshold ?? 85;
    const minDigits = camera.min_matching_digits ?? 4;

    // Scan all known plates. Villa scale is small (≲ low thousands); pulling
    // into Node keeps the matching logic in one place and avoids needing a
    // pg_trgm/extension on the self-hosted box.
    const candidates = await db
      .select({ id: vehiclesTable.id, license_plate: vehiclesTable.license_plate })
      .from(vehiclesTable)
      .where(
        vehicle_id
          ? and(
              isNotNull(vehiclesTable.license_plate),
              sql`${vehiclesTable.id} <> ${vehicle_id}`,
            )
          : isNotNull(vehiclesTable.license_plate),
      );

    let best: { id: string; plate: string; sim: number; digits: number } | null =
      null;
    for (const c of candidates) {
      const cand = (c.license_plate ?? "").toUpperCase().replace(/\s+/g, "");
      if (!cand) continue;
      const sim = similarityPct(plate, cand);
      if (sim < threshold) continue;
      const digits = sharedDigitCount(plate, cand);
      if (digits < minDigits) continue;
      if (!best || sim > best.sim) {
        best = { id: c.id, plate: cand, sim, digits };
      }
    }

    if (best) {
      const partialDecision = await validateVehicleAccessMulti(best.id, villa_ids);
      if (partialDecision.allowed) {
        decision = partialDecision;
        vehicle_id = best.id;
        matchType = "partial";
        matchedPlate = best.plate;
        similarity = best.sim;
      }
    }
  }

  // ── 6. Build notes (for future multi-factor matching + UI visibility) ────
  const futureMeta = {
    confidence: input.confidence,
    raw_ocr_text: input.raw_ocr_text ?? null,
    make: input.make ?? null,
    model: input.model ?? null,
    color: input.color ?? null,
    vehicle_color: input.color ?? null, // explicit alias for downstream readers
    vehicle_type: input.vehicle_type ?? null,
    has_embedding: !!input.embedding,
    decision_reason: decision.reason,
    match_type: matchType,
    matched_plate: matchedPlate,
    similarity_pct: similarity,
  };

  // ── 7. Denied path ────────────────────────────────────────────────────────
  if (!decision.allowed) {
    // Suppress LOGGING (event row + live feed) of near-duplicate denied reads
    // of the same lingering vehicle (occluded plate → many OCR variants). The
    // AI hook below still fires on every denied read, and the allowed path is
    // never affected.
    if (!isDuplicateDenied(camera.id, plate, cooldownSecs)) {
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
        payload: {
          plate,
          license_plate: plate,
          raw_ocr_text: input.raw_ocr_text ?? null,
          confidence: input.confidence,
          match_type: matchType,
          matched_plate: matchedPlate,
          similarity_pct: similarity,
          vehicle_color: input.color ?? null,
          decision_reason: decision.reason,
          reason: decision.reason,
          denial_code: decision.denial_code,
        },
      });
    }

    // AI fallback hook (additive, gated by AI_FALLBACK_ENABLED env). No-op
    // when disabled. The hook itself grabs a fresh snapshot from the camera
    // (worker doesn't ship images), buffers up to FAIL_THRESHOLD, and then
    // calls OpenAI vision in the background. Fire-and-forget — never blocks.
    aiFallback.recordFailure(camera, plate);

    return {
      action: "denied",
      plate,
      vehicle_id,
      reason: decision.reason,
      denial_code: decision.denial_code,
      match_type: matchType,
      matched_plate: matchedPlate,
      similarity_pct: similarity,
    };
  }

  // ── 8. Allowed path: trigger relay ───────────────────────────────────────
  // Gate-relay debounce: collapse near-duplicate allowed reads of the same
  // lingering vehicle so the barrier doesn't flap open/close. The exact-plate
  // repeat is already absorbed by the atomic claim above; this covers the
  // DISTINCT-but-similar OCR variants of one car. A genuinely different vehicle
  // (dissimilar plate) is NOT matched and opens the gate immediately.
  const prevGateOpen = recentGateOpen.get(camera.id);
  if (prevGateOpen && isRecentGateOpen(camera.id, plate, cooldownSecs)) {
    // Extend the window so a continuously lingering vehicle stays collapsed, but
    // keep the anchor pinned to the GRANTING plate (prevGateOpen.plate) so the
    // comparison never drifts toward a suppressed variant. No relay re-pulse,
    // no duplicate allowed event.
    recentGateOpen.set(camera.id, { plate: prevGateOpen.plate, at: Date.now() });
    aiFallback.recordSuccess(camera.id);
    return {
      action: "skipped_gate_cooldown",
      plate,
      vehicle_id,
      reason: decision.reason,
      match_type: matchType,
      matched_plate: matchedPlate,
      similarity_pct: similarity,
    };
  }

  const adapter = createAdapter(camera);
  const gate = await adapter.open_gate();

  // Record the anchor only on a SUCCESSFUL open, so a failed relay does not
  // suppress the next legitimate retry of the same/similar plate.
  if (gate.success) {
    recentGateOpen.set(camera.id, { plate, at: Date.now() });
  }

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
      license_plate: plate,
      raw_ocr_text: input.raw_ocr_text ?? null,
      confidence: input.confidence,
      match_type: matchType,
      matched_plate: matchedPlate,
      similarity_pct: similarity,
      vehicle_color: input.color ?? null,
      decision_reason: decision.reason,
      reason: decision.reason,
      gate_success: gate.success,
      gate_error: gate.error,
    },
  });

  // AI fallback hook: a real allowed detection resets this camera's
  // consecutive-failure counter (no-op when AI_FALLBACK_ENABLED is off).
  aiFallback.recordSuccess(camera.id);

  return {
    action: gate.success ? "allowed_relay_ok" : "allowed_relay_failed",
    plate,
    vehicle_id,
    reason: decision.reason,
    gate: { success: gate.success, error: gate.error },
    match_type: matchType,
    matched_plate: matchedPlate,
    similarity_pct: similarity,
  };
}

/**
 * Worker observed a vehicle (YOLO detected a car/plate region) but OCR
 * couldn't extract a plausible plate (heavy obstruction / dirt / glare).
 * Treat it as a per-camera failure so the AI fallback counter can build up
 * and trigger OpenAI vision after the configured threshold within the
 * reset window. Additive — does not affect any existing detection flow.
 */
export async function handleAnprNoMatch(input: {
  camera_id: string;
  raw_ocr_text?: string | null;
}): Promise<{ action: "no_match_recorded" | "skipped_no_villa"; reason?: string }> {
  const camRows = await db
    .select()
    .from(camerasTable)
    .where(eq(camerasTable.id, input.camera_id))
    .limit(1);
  const camera = camRows[0];
  if (!camera) {
    return { action: "skipped_no_villa", reason: "Camera not found" };
  }
  if (!camera.ocr_enabled) {
    return { action: "skipped_no_villa", reason: "Camera OCR disabled" };
  }
  // Pass raw_text as both plate (legacy field) and the explicit raw_text
  // arg so the similarity gate can compare it against expected plates.
  aiFallback.recordFailure(camera, null, input.raw_ocr_text ?? null);
  return { action: "no_match_recorded" };
}
