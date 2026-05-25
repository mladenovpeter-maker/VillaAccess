/**
 * Smart-lock adapter interface.
 *
 * Mirrors the CameraAdapter pattern in ../cameras/types.ts so a future
 * Aqara / Yale / August / Z-Wave adapter can be dropped in without
 * touching business logic.
 *
 * Phase 1 (read-only) requires only:
 *   - getStatus()      — online/battery/last_seen
 *   - listOpenRecords() — recent unlock events from the device
 *
 * Phase 2 will add:
 *   - createTempPassword() / deleteTempPassword() / listTempPasswords()
 *
 * Phase 3+ may add:
 *   - unlockNow() — manual remote unlock (best-effort, may be 1-3s latent)
 */

export interface LockStatusResult {
  online: boolean;
  battery_pct: number | null;
  last_seen_at: string | null; // ISO
  raw: unknown; // raw provider payload for debug / device_info
}

export interface LockOpenRecord {
  at: string; // ISO timestamp
  method: string; // 'password' | 'fingerprint' | 'card' | 'app' | 'temporary_password' | ...
  user: string | null;
  raw: unknown;
}

export interface ListOpenRecordsOptions {
  page?: number;       // 1-based
  page_size?: number;  // default 20, max 100
  start_time?: number; // epoch ms, optional lower bound
  end_time?: number;   // epoch ms, optional upper bound
}

export interface LockAdapter {
  /** Quick liveness + battery + last-seen probe. */
  getStatus(): Promise<LockStatusResult>;
  /** Recent unlock events from the lock (provider-side audit log). */
  listOpenRecords(opts?: ListOpenRecordsOptions): Promise<LockOpenRecord[]>;
}

/**
 * Minimal DB row shape needed to build an adapter — keeps factory.ts
 * decoupled from the full Drizzle type (matches CameraRow style).
 */
export interface LockRow {
  id: string;
  name: string;
  protocol: string | null;
  tuya_device_id: string | null;
}
