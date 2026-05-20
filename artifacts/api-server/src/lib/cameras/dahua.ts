/**
 * Dahua HTTP API adapter — STUB
 *
 * Dahua uses a proprietary HTTP API (not ONVIF-native), with endpoints like:
 *   GET /cgi-bin/snapshot.cgi?channel={ch}               → JPEG snapshot
 *   GET /cgi-bin/configQuery.fcgi?name=General            → device info
 *   POST /cgi-bin/accessControl.cgi?action=openDoor       → door control
 *
 * TODO: Implement when Dahua hardware is available.
 *   Reference: Dahua HTTP API 2.78 Programming Guide
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

export class DahuaAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  async get_snapshot(): Promise<SnapshotResult> {
    // When implemented: GET /cgi-bin/snapshot.cgi?channel=0&subtype=0
    return this._notImplemented("get_snapshot", {
      success: false,
      captured_at: new Date(),
    });
  }

  async open_gate(): Promise<GateResult> {
    // When implemented: POST /cgi-bin/accessControl.cgi?action=openDoor&channel=1
    return this._notImplemented("open_gate", {
      success: false,
      action: "gate" as const,
      command: "open" as const,
      target_no: this.config.gate_no ?? 1,
      mode: "access_control" as const,
      executed_at: new Date(),
    });
  }

  async open_door(): Promise<GateResult> {
    // When implemented: POST /cgi-bin/accessControl.cgi?action=openDoor&channel=2
    return this._notImplemented("open_door", {
      success: false,
      action: "door" as const,
      command: "open" as const,
      target_no: this.config.door_no ?? 2,
      mode: "access_control" as const,
      executed_at: new Date(),
    });
  }

  async get_status(): Promise<StatusResult> {
    // When implemented: GET /cgi-bin/magicBox.cgi?action=getSystemInfo
    return this._notImplemented("get_status", {
      success: false,
      online: false,
      checked_at: new Date(),
    });
  }

  private _notImplemented<T extends object>(method: string, base: T): T {
    return {
      ...base,
      error: `Dahua adapter: ${method}() is not yet implemented. Protocol: dahua`,
    };
  }
}
