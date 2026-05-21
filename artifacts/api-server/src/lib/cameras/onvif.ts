/**
 * ONVIF adapter — STUB
 *
 * ONVIF Profile S/T (media + snapshots). Door control is handled by the
 * Intercoms layer, not by this camera adapter.
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

export class ONVIFAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  async get_snapshot(): Promise<SnapshotResult> {
    return { success: false, captured_at: new Date(), error: "ONVIF adapter: get_snapshot() not implemented" };
  }

  async open_gate(): Promise<GateResult> {
    return {
      success: false,
      target_no: this.config.gate_no ?? 1,
      mode: "stub",
      error: "ONVIF adapter: open_gate() not implemented",
    };
  }

  async get_status(): Promise<StatusResult> {
    return { online: false, checked_at: new Date(), error: "ONVIF adapter: get_status() not implemented" };
  }
}
