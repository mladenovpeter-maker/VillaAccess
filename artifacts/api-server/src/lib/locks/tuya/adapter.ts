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
import { tuyaRequest } from "./client";

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

interface TuyaOpenRecord {
  time?: number; // epoch ms
  unlock_method?: string;
  user_name?: string | null;
  user_id?: string | null;
  [k: string]: unknown;
}

interface TuyaOpenRecordsPage {
  logs?: TuyaOpenRecord[];
  total?: number;
  has_more?: boolean;
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
 * Decrypt the per-ticket AES-128 session key.
 *
 *   ticket_key (hex) = AES-128-ECB-NoPadding(plain_session_key,
 *                                            key=AccessSecret[0:16])
 *
 * Returns the raw 16-byte session key. Throws on length mismatch.
 */
function decryptTicketKey(ticketKeyHex: string): Buffer {
  const secret = readAccessSecret();
  const aesKey = Buffer.from(secret.slice(0, 16), "utf8");
  const ciphertext = Buffer.from(ticketKeyHex, "hex");
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error(
      `Tuya ticket_key has unexpected length ${ciphertext.length} (must be multiple of 16)`,
    );
  }
  const decipher = crypto.createDecipheriv("aes-128-ecb", aesKey, null);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // The decrypted buffer should be exactly 16 bytes (one AES block) — the
  // session key. Some Tuya regions return additional PKCS#7 padding bytes;
  // in that case take the first 16.
  return plain.subarray(0, 16);
}

/**
 * AES-128-ECB ENCRYPT the PIN with PKCS#7 padding, returned as lowercase hex.
 * Tuya's spec requires PKCS#7 padding for the password field.
 */
function encryptPin(pin: string, sessionKey: Buffer): string {
  const cipher = crypto.createCipheriv("aes-128-ecb", sessionKey, null);
  cipher.setAutoPadding(true);
  const ct = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return ct.toString("hex");
}

/** Local IANA time-zone name, e.g. "Europe/Sofia". Tuya rejects offset format
 * ("+02:00") with code 1109 "param is illegal"; only IANA names are accepted. */
function localTimeZoneOffset(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Sofia";
  } catch {
    return "Europe/Sofia";
  }
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
    return {
      online: extractOnline(info),
      battery_pct: extractBattery(info.status),
      last_seen_at: extractLastSeen(info),
      raw: info,
    };
  }

  async listOpenRecords(opts: ListOpenRecordsOptions = {}): Promise<LockOpenRecord[]> {
    const page_no = Math.max(1, opts.page ?? 1);
    const page_size = Math.max(1, Math.min(100, opts.page_size ?? 20));
    const query: Record<string, string | number | undefined> = { page_no, page_size };
    if (opts.start_time) query.start_time = opts.start_time;
    if (opts.end_time) query.end_time = opts.end_time;

    const page = await tuyaRequest<TuyaOpenRecordsPage>({
      method: "GET",
      path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/open-records`,
      query,
    });

    const logs = page?.logs ?? [];
    return logs.map((r) => ({
      at: typeof r.time === "number" ? new Date(r.time).toISOString() : new Date(0).toISOString(),
      method: r.unlock_method ?? "unknown",
      user: r.user_name ?? r.user_id ?? null,
      raw: r,
    }));
  }

  // ── Phase 2 ────────────────────────────────────────────────────────────

  async createTempPassword(input: CreateTempPasswordInput): Promise<CreateTempPasswordResult> {
    // Step 1 — fetch a one-shot encryption ticket for this device.
    // Note: Tuya requires POST (not GET) on this endpoint as of 2025; GET returns
    // "uri path invalid" (code 1108).
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

    // Step 4 — create the temp password on the device.
    const body = {
      password:        encryptedPin,
      password_type:   "ticket",
      ticket_id:       ticket.ticket_id,
      effective_time:  toEpochSeconds(input.valid_from),
      invalid_time:    toEpochSeconds(input.valid_to),
      name:            input.name.slice(0, 32), // Tuya caps name length
      type:            0,                       // temporary (single-period)
      phone:           "",
      time_zone:       localTimeZoneOffset(),
    };

    const resp = await tuyaRequest<TuyaCreateTempPasswordResponse>({
      method: "POST",
      path: `/v1.0/devices/${encodeURIComponent(this.deviceId)}/door-lock/temp-password`,
      body,
    });

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
