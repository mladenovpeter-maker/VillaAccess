/**
 * Smart-lock adapter interface.
 *
 * Mirrors the CameraAdapter pattern in ../cameras/types.ts so a future
 * Aqara / Yale / August / Z-Wave adapter can be dropped in without
 * touching business logic.
 *
 * Phase 1 (read-only):
 *   - getStatus()       — online/battery/last_seen
 *   - listOpenRecords() — recent unlock events from the device
 *
 * Phase 2 (write — temp passwords):
 *   - createTempPassword({pin, name, valid_from, valid_to})
 *       → returns provider-side password id
 *   - deleteTempPassword(passwordId)
 *   - listTempPasswords()
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
  method: string; // 'password' | 'fingerprint' | 'card' | 'app' | 'temporary' | ...
  /** Credential slot/index used (Tuya DP value), when reported. */
  index?: number | null;
  user: string | null;
  raw: unknown;
}

export interface ListOpenRecordsOptions {
  page?: number;       // 1-based
  page_size?: number;  // default 20, max 100
  start_time?: number; // epoch ms, optional lower bound
  end_time?: number;   // epoch ms, optional upper bound
}

export interface CreateTempPasswordInput {
  /** PIN as a numeric string. Tuya door locks accept 4 digits. */
  pin: string;
  /** Human-readable label shown in the Smart Life app. */
  name: string;
  /** Start of validity window. */
  valid_from: Date;
  /** End of validity window. */
  valid_to: Date;
}

export interface CreateTempPasswordResult {
  /** Provider-side id (stored in smart_lock_passwords.provider_password_id). */
  password_id: string;
  raw: unknown;
}

export interface TempPasswordSummary {
  password_id: string;
  name: string | null;
  effective_time: string | null; // ISO
  invalid_time: string | null;   // ISO
  /** 'normal' | 'expired' | 'to_be_activated' | ... (provider-specific). */
  status: string | null;
  raw: unknown;
}

export interface LockAdapter {
  /** Quick liveness + battery + last-seen probe. */
  getStatus(): Promise<LockStatusResult>;
  /** Recent unlock events from the lock (provider-side audit log). */
  listOpenRecords(opts?: ListOpenRecordsOptions): Promise<LockOpenRecord[]>;

  /** Phase 2 — create a one-shot temp password valid for a reservation window. */
  createTempPassword(input: CreateTempPasswordInput): Promise<CreateTempPasswordResult>;
  /** Phase 2 — delete an existing temp password by its provider-side id. */
  deleteTempPassword(passwordId: string): Promise<void>;
  /** Phase 2 — list all temp passwords currently on the device. */
  listTempPasswords(): Promise<TempPasswordSummary[]>;
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
