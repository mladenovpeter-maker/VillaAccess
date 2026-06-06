/**
 * Tuya implementation of the LockAdapter interface.
 *
 * Phase 1: getStatus() + listOpenRecords()    (read-only)
 * Phase 2: temp-password CRUD                 (encrypted PIN push)
 *
 * ── Status mapping (Phase 1, unchanged) ──────────────────────────────────────
 *   - `online`        ← /v1.0/iot-03/devices/{id}.online (fallback to
 *                       status[] code="online")
 *   - `battery_pct`   ← status[] code IN ("battery_percentage",
 *                       "residual_electricity", "battery_state"). Coarse
 *                       string values (low/middle/high) → 20/55/90.
 *   - `last_seen_at`  ← device-info.update_time (epoch seconds), fallback
 *                       to active_time, else null.
 *
 * ── Temp-password flow (Phase 2) ─────────────────────────────────────────────
 * Tuya door locks require the PIN to be transmitted ENCRYPTED. The flow is:
 *
 *   1. POST /v1.0/devices/{deviceId}/door-lock/password-ticket
 *           → { ticket_id, ticket_key }
 *           ticket_key is hex-encoded AES-128-ECB ciphertext of a random
 *           per-ticket AES key, encrypted with the project's AccessSecret
 *           (first 16 bytes) as the AES-128 key.
 *
 *   2. AES-128-ECB DECRYPT (ticket_key, key=AccessSecret[0:16])
 *           → raw 16-byte AES-128 session key
 *
 *   3. AES-128-ECB ENCRYPT (PIN, key=session_key)
 *           → hex(encrypted_pin)
 *
 *   4. POST /v1.0/devices/{deviceId}/door-lock/temp-password
 *           body: {
 *             password:       <hex>,
 *             password_type:  "ticket",
 *             ticket_id:      <ticket from step 1>,
 *             effective_time: <epoch seconds>,
 *             invalid_time:   <epoch seconds>,
 *             name:           <label shown in Smart Life>,
 *             type:           0,   // 0 = temporary, single-period
 *             phone:          "",  // required by spec, can be empty
 *             time_zone:      "+02:00",
 *           }
 *           → { id: "<provider_password_id>" }
 *
 *   5. DELETE /v1.0/devices/{deviceId}/door-lock/temp-password/{password_id}
 *
 *   6. GET  /v1.0/devices/{deviceId}/door-lock/temp-passwords
 *           → list of existing passwords (for diagnostics + force-sync)
 *
 * NOTE on the cloud-project requirement: the project must have the
 * "IoT Core" + "Authorization Token Management" + "Smart Lock Open
 * Service" (or "Smart Home Devices Management") API products linked.
 * If the device returns code=1106 ("permission denied") on the
 * password-ticket call, those services are missing in the Cloud Project.
 */

import * as crypto from "crypto";
import type {
  LockAdapter,
  LockStatusResult,
  LockOpenRecord,
  ListOpenRecordsOptions,
  LockRow,
  CreateTempPasswordInput,
  CreateTempPasswordResult,
  TempPasswordSummary,
} from "../types";
import { tuyaRequest, TuyaApiError } from "./client";

// ────────────────────────────────────────────────────────────────────────────
// Status / open-records types (Phase 1)
// ────────────────────────────────────────────────────────────────────────────

interface TuyaStatusItem {
  code: string;
  value: string | number | boolean;
}

interface TuyaDeviceInfo {
  id?: string;
  online?: boolean;
  update_time?: number; // epoch seconds
  active_time?: number;
  status?: TuyaStatusItem[];
  [k: string]: unknown;
}

// Device-log entry returned by /v1.0/devices/{id}/logs (type=7 data report).
// Unlock events surface here as DP reports (code = unlock_fingerprint/password/…,
// value = the credential index used). This is the reliable source for the
// "opening journal" — the higher-level door-lock/open-records endpoint is empty
// for many lock models (incl. the units in this deployment).
interface TuyaDeviceLog {
  event_time?: number; // epoch ms
  event_id?: number;   // event type (7 = data report)
  code?: string;       // DP code, e.g. "unlock_fingerprint"
  value?: string | number | boolean;
  status?: string;
  event_from?: string;
  [k: string]: unknown;
}

interface TuyaDeviceLogsPage {
  logs?: TuyaDeviceLog[];
  has_next?: boolean;
  current_row_key?: string;
  next_row_key?: string;
}

// DP codes that represent an actual door opening, mapped to a stable method
// token the dashboard translates (locks.method.*).
const UNLOCK_LOG_CODES: Record<string, string> = {
  unlock_fingerprint: "fingerprint",
  unlock_password:    "password",
  unlock_card:        "card",
  unlock_face:        "face",
  unlock_key:         "key",
  unlock_app:         "app",
  unlock_temporary:   "temporary",
  unlock_dynamic:     "dynamic",
  unlock_phone_remote:"remote",
  unlock_voice_remote:"remote",
  unlock_request:     "request",
  unlock_hand:        "hand",
  unlock_eye:         "eye",
  unlock_finger_vein: "finger_vein",
};

function parseUnlockIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const BATTERY_CODES = new Set([
  "battery_percentage",
  "residual_electricity",
  "battery_state",
  "battery",
]);

const COARSE_BATTERY_MAP: Record<string, number> = {
  low: 20,
  middle: 55,
  medium: 55,
  high: 90,
  full: 100,
};

function extractBattery(status: TuyaStatusItem[] | undefined): number | null {
  if (!status) return null;
  for (const item of status) {
    if (!BATTERY_CODES.has(item.code)) continue;
    const v = item.value;
    if (typeof v === "number" && Number.isFinite(v)) {
      return Math.max(0, Math.min(100, Math.round(v)));
    }
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      if (lower in COARSE_BATTERY_MAP) return COARSE_BATTERY_MAP[lower];
      const n = Number(v);
      if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
    }
  }
  return null;
}

function extractOnline(info: TuyaDeviceInfo): boolean {
  if (typeof info.online === "boolean") return info.online;
  const onlineItem = info.status?.find((s) => s.code === "online");
  if (onlineItem && typeof onlineItem.value === "boolean") return onlineItem.value;
  return false;
}

function extractLastSeen(info: TuyaDeviceInfo): string | null {
  if (typeof info.update_time === "number" && info.update_time > 0) {
    return new Date(info.update_time * 1000).toISOString();
  }
  if (typeof info.active_time === "number" && info.active_time > 0) {
    return new Date(info.active_time * 1000).toISOString();
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Temp-password types (Phase 2)
// ────────────────────────────────────────────────────────────────────────────

interface TuyaPasswordTicket {
  ticket_id: string;
  ticket_key: string; // hex, AES-128-ECB encrypted with AccessSecret[0:16]
  expire_time?: number;
}

interface TuyaCreateTempPasswordResponse {
  id: number | string;
}

interface TuyaTempPasswordItem {
  id?: number | string;
  name?: string | null;
  effective_time?: number; // epoch seconds
  invalid_time?: number;   // epoch seconds
  status?: string;
  [k: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Crypto helpers — Tuya temp-password encryption
// ────────────────────────────────────────────────────────────────────────────

function readAccessSecret(): string {
  const s = process.env.TUYA_ACCESS_SECRET;
  if (!s) throw new Error("TUYA_ACCESS_SECRET is not set");
  return s;
}

/**
 * Decrypt the per-ticket session key.
 *
 *   ticket_key (hex) = AES-256-ECB(plain_session_key, key=AccessSecret[full 32B])
 *
 * Returns the raw 16-byte session key. Throws on length mismatch.
 */
function decryptTicketKey(ticketKeyHex: string): Buffer {
  const secret = readAccessSecret();
  // Tuya encrypts ticket_key with the FULL Access Secret used as an AES-256 key
  // (the 32-char secret read as a UTF-8 string = 32 bytes). Using only the first
  // 16 bytes as an AES-128 key yields a WRONG 16-byte session key, so the
  // temp-password is then encrypted with the wrong key and Tuya rejects the
  // create request with code 1109 "param is illegal". This is the documented,
  // forum-confirmed flow (aes-256-ecb decrypt → 16-byte key → aes-128 encrypt).
  const aesKey = Buffer.from(secret, "utf8");
  if (aesKey.length !== 32) {
    throw new Error(
      `TUYA_ACCESS_SECRET must be 32 bytes for AES-256 ticket decryption, got ${aesKey.length}`,
    );
  }
  const ciphertext = Buffer.from(ticketKeyHex, "hex");
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error(
      `Tuya ticket_key has unexpected length ${ciphertext.length} (must be multiple of 16)`,
    );
  }
  const decipher = crypto.createDecipheriv("aes-256-ecb", aesKey, null);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // The decrypted blob is the 16-byte session key followed by PKCS#7 padding.
  // Take the first 16 bytes (works whether or not a padding block is present).
  return plain.subarray(0, 16);
}

/**
 * AES-128-ECB ENCRYPT the PIN with PKCS#7 padding, returned as UPPERCASE hex.
 * Tuya's spec requires PKCS#7 padding for the password field.
 */
function encryptPin(pin: string, sessionKey: Buffer): string {
  const cipher = crypto.createCipheriv("aes-128-ecb", sessionKey, null);
  cipher.setAutoPadding(true);
  const ct = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  // Tuya's examples use UPPERCASE hex for the password field.
  return ct.toString("hex").toUpperCase();
}

/** Local IANA time-zone name, e.g. "Europe/Sofia". Tuya rejects offset format
 * ("+02:00") with code 1109 "param is illegal"; only IANA names are accepted.
 * In a Docker/UTC container Intl resolves to "UTC"/"Etc/UTC", which some lock
 * models also reject with 1109 — fall back to a real regional zone in that case. */
function localTimeZoneOffset(): string {
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    tz = "";
  }
  if (!tz || tz === "UTC" || tz === "Etc/UTC" || tz === "Etc/Universal") {
    return "Europe/Sofia";
  }
  return tz;
}

// Bulgarian/Cyrillic → Latin transliteration map for the Tuya temp-password
// `name` field. Tuya only accepts ASCII letters/digits/spaces here; Cyrillic or
// special chars are rejected with code 1109 "param is illegal".
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya",
};

/** Make a name safe for Tuya's temp-password `name` field: transliterate
 * Cyrillic to Latin, drop any remaining non-ASCII / special chars (keep
 * letters, digits, spaces), collapse whitespace, cap at 32 chars. Falls back
 * to "Guest" if nothing usable remains. */
function asciiSafeName(raw: string): string {
  const translit = Array.from(raw ?? "")
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = CYRILLIC_TO_LATIN[lower];
      if (mapped == null) return ch;
      // Preserve original case for single-letter mappings.
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join("");
  const cleaned = translit
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return cleaned.length > 0 ? cleaned : "Guest";
}

function toEpochSeconds(d: Date): number {
  // NOTE: Tuya updated the door-lock/temp-password endpoint to require
  // epoch MILLISECONDS (not seconds). Function name kept for backwards
  // compatibility; returns ms.
  return d.getTime();
}

function toIsoOrNull(secs: number | undefined): string | null {
  if (typeof secs !== "number" || secs <= 0) return null;
  return new Date(secs * 1000).toISOString();
}

// ────────────────────────────────────────────────────────────────────────────
// Adapter
// ────────────────────────────────────────────────────────────────────────────

export class TuyaLockAdapter implements LockAdapter {
  private readonly deviceId: string;

  constructor(row: LockRow) {
    if (!row.tuya_device_id) {
      throw new Error(`Lock "${row.id}" (${row.name}) has no tuya_device_id`);
    }
    this.deviceId = row.tuya_device_id;
  }

  // ── Phase 1 ────────────────────────────────────────────────────────────

  async getStatus(): Promise<LockStatusResult> {
    const info = await tuyaRequest<TuyaDeviceInfo>({
      method: "GET",
      path: `/v1.0/iot-03/devices/${encodeURIComponent(this.deviceId)}`,
    });
    // The device-detail call doesn't always include the live DP `status` array,
    // so battery (residual_electricity) can come back null. Fetch the latest
    // status separately when needed — read-only, best-effort.
    let statusArr = info.status;
    if (!statusArr || extractBattery(statusArr) == null) {
      try {
        const fresh = await tuyaRequest<TuyaStatusItem[]>({
          method: "GET",
          path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/status`,
        });
        if (Array.isArray(fresh) && fresh.length > 0) statusArr = fresh;
      } catch {
        /* keep info.status fallback */
      }
    }
    return {
      online: extractOnline(info),
      battery_pct: extractBattery(statusArr),
      last_seen_at: extractLastSeen(info),
      raw: { ...info, status: statusArr },
    };
  }

  async listOpenRecords(opts: ListOpenRecordsOptions = {}): Promise<LockOpenRecord[]> {
    const page_size = Math.max(1, Math.min(100, opts.page_size ?? 20));
    const end_time = opts.end_time ?? Date.now();
    const start_time = opts.start_time ?? end_time - 30 * 24 * 60 * 60 * 1000; // 30d window
    // Over-fetch type-7 (data report) logs then keep only opening events — other
    // DP reports (online, battery, …) share the same log stream.
    const fetchSize = Math.min(100, Math.max(page_size * 3, 50));

    const page = await tuyaRequest<TuyaDeviceLogsPage>({
      method: "GET",
      path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/logs`,
      query: { type: 7, start_time, end_time, size: fetchSize },
    });

    const logs = page?.logs ?? [];
    const records: LockOpenRecord[] = [];
    for (const log of logs) {
      const method = log.code ? UNLOCK_LOG_CODES[log.code] : undefined;
      if (!method) continue;
      records.push({
        at: typeof log.event_time === "number"
          ? new Date(log.event_time).toISOString()
          : new Date(0).toISOString(),
        method,
        index: parseUnlockIndex(log.value),
        user: null,
        raw: log,
      });
    }
    return records.slice(0, page_size);
  }

  // ── Phase 2 ────────────────────────────────────────────────────────────

  async createTempPassword(input: CreateTempPasswordInput): Promise<CreateTempPasswordResult> {
    // Compute the validity window in MILLISECONDS once.
    // Tuya constraints discovered empirically (type=0 temp password):
    //   1. effective_time must be strictly in the future (now+0 → 1109)
    //   2. (invalid_time - effective_time) must be >= ~24h (6h/12h → 1109; 24h+ → ok)
    // When a reservation's window violates either, bump it minimally so the API
    // accepts the request. The PIN is still revoked by lock-sync when the
    // reservation ends, so over-extending invalid_time is safe.
    const TUYA_MIN_FUTURE_MS   = 60 * 1000;
    const TUYA_MIN_DURATION_MS = 24 * 60 * 60 * 1000;
    const earliest     = Date.now() + TUYA_MIN_FUTURE_MS;
    const effectiveMs  = Math.max(input.valid_from.getTime(), earliest);
    const invalidMs    = Math.max(input.valid_to.getTime(), effectiveMs + TUYA_MIN_DURATION_MS);

    // Tuya temp-password time unit is ambiguous across lock models: some accept
    // epoch SECONDS (the documented default), others epoch MILLISECONDS. A wrong
    // unit is rejected with code 1109 "param is illegal". Try seconds first, then
    // fall back to milliseconds — each attempt needs a FRESH one-shot ticket.
    const attempt = async (unit: "s" | "ms"): Promise<TuyaCreateTempPasswordResponse> => {
      // Step 1 — fetch a one-shot encryption ticket for this device.
      // Note: Tuya requires POST (not GET) on this endpoint as of 2025; GET
      // returns "uri path invalid" (code 1108).
      const ticket = await tuyaRequest<TuyaPasswordTicket>({
        method: "POST",
        path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/password-ticket`,
      });
      if (!ticket?.ticket_id || !ticket?.ticket_key) {
        throw new Error(`Tuya password-ticket response missing ticket_id/ticket_key for device ${this.deviceId}`);
      }

      // Step 2/3 — decrypt the session key, then encrypt the PIN.
      const sessionKey = decryptTicketKey(ticket.ticket_key);
      const encryptedPin = encryptPin(input.pin, sessionKey);

      const div = unit === "s" ? 1000 : 1;
      const body = {
        password:        encryptedPin,
        password_type:   "ticket",
        ticket_id:       ticket.ticket_id,
        effective_time:  Math.floor(effectiveMs / div),
        invalid_time:    Math.floor(invalidMs / div),
        name:            asciiSafeName(input.name), // Tuya rejects non-ASCII / >32 chars (1109)
        type:            0,                          // temporary (single-period)
        phone:           "",
        time_zone:       localTimeZoneOffset(),
      };

      console.log(`[tuya.createTempPassword] device=${this.deviceId} unit=${unit} body=${JSON.stringify({...body, password: `<${body.password.length}hex>`})}`);
      return tuyaRequest<TuyaCreateTempPasswordResponse>({
        method: "POST",
        path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/temp-password`,
        body,
      });
    };

    let resp: TuyaCreateTempPasswordResponse;
    try {
      resp = await attempt("s");
    } catch (err) {
      const isIllegalParam =
        (err instanceof TuyaApiError && err.code === 1109) ||
        /\b1109\b/.test(String((err as Error)?.message ?? err));
      if (isIllegalParam) {
        console.warn(`[tuya.createTempPassword] seconds rejected (1109); retrying with milliseconds`);
        resp = await attempt("ms");
      } else {
        throw err;
      }
    }

    if (resp?.id == null) {
      throw new Error(`Tuya temp-password response missing id for device ${this.deviceId}`);
    }
    return { password_id: String(resp.id), raw: resp };
  }

  async deleteTempPassword(passwordId: string): Promise<void> {
    await tuyaRequest({
      method: "DELETE",
      path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/temp-password/${encodeURIComponent(passwordId)}`,
    });
  }

  async listTempPasswords(): Promise<TempPasswordSummary[]> {
    const list = await tuyaRequest<TuyaTempPasswordItem[]>({
      method: "GET",
      path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/temp-passwords`,
    });
    const items = Array.isArray(list) ? list : [];
    return items.map((p) => ({
      password_id: String(p.id ?? ""),
      name: p.name ?? null,
      effective_time: toIsoOrNull(p.effective_time),
      invalid_time: toIsoOrNull(p.invalid_time),
      status: typeof p.status === "string" ? p.status : null,
      raw: p,
    }));
  }
}
