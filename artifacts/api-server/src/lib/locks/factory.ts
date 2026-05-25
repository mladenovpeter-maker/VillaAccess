/**
 * LockAdapter factory.
 *
 * Mirrors lib/cameras/factory.ts. New lock protocols are added by an
 * import + case below; nothing else changes for the callers.
 */

import type { LockAdapter, LockRow } from "./types";
import { TuyaLockAdapter } from "./tuya/adapter";

export function createLockAdapter(row: LockRow): LockAdapter {
  const protocol = (row.protocol ?? "tuya").toLowerCase();
  switch (protocol) {
    case "tuya":
      return new TuyaLockAdapter(row);
    default:
      throw new Error(`Unknown smart-lock protocol: "${protocol}"`);
  }
}
