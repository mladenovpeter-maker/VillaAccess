/**
 * Dahua HTTP API adapter — STUB
 *
 * Dahua uses a proprietary HTTP API. Endpoints (when implemented):
 *   GET  /cgi-bin/snapshot.cgi?channel={ch}            → JPEG snapshot
 *   POST /cgi-bin/coreDevice.cgi?action=triggerOutput  → I/O relay output
 *   GET  /cgi-bin/magicBox.cgi?action=getSystemInfo    → device info
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

export class DahuaAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  async get_snapshot(): Promise<SnapshotResult> {
    return { success: false, captured_at: new Date(), error: "Dahua adapter: get_snapshot() not implemented" };
  }

  async open_gate(): Promise<GateResult> {
    return {
      success: false,
      target_no: this.config.gate_no ?? 1,
      mode: "stub",
      error: "Dahua adapter: open_gate() not implemented",
    };
  }

  async get_status(): Promise<StatusResult> {
    return { online: false, checked_at: new Date(), error: "Dahua adapter: get_status() not implemented" };
  }
}
