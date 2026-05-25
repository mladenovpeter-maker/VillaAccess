/**
 * Tuya implementation of the LockAdapter interface.
 *
 * Phase 1 scope: read-only — getStatus() + listOpenRecords().
 *
 * Status mapping:
 *   - `online` flag comes from /v1.0/iot-03/devices/{id}/status.online
 *     (Tuya returns it as a top-level field on device-info, NOT inside
 *     the `status` array). We fall back to inspecting the `status` array
 *     code="online" if present.
 *   - `battery_pct` is read from status[] code IN
 *     ("battery_percentage", "residual_electricity", "battery_state").
 *     Some locks only expose a coarse "low/middle/high" string — we map
 *     those to 20/55/90 respectively. Returns null if unknown.
 *   - `last_seen_at` uses device-info.update_time (epoch SECONDS) when
 *     available, else null.
 *
 * Open records mapping:
 *   - GET /v1.0/devices/{id}/door-lock/open-records returns
 *     { logs: [...], total, has_more } with each log shaped as
 *     { time, unlock_method, user_name, user_id, ... }. We normalise
 *     into the LockOpenRecord interface.
 */

import type {
  LockAdapter,
  LockStatusResult,
  LockOpenRecord,
  ListOpenRecordsOptions,
  LockRow,
} from "../types";
import { tuyaRequest } from "./client";

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
  "battery", // some older lock profiles
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

export class TuyaLockAdapter implements LockAdapter {
  private readonly deviceId: string;

  constructor(row: LockRow) {
    if (!row.tuya_device_id) {
      throw new Error(`Lock "${row.id}" (${row.name}) has no tuya_device_id`);
    }
    this.deviceId = row.tuya_device_id;
  }

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
    const query: Record<string, string | number | undefined> = {
      page_no,
      page_size,
    };
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
}
