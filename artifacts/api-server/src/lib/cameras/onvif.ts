/**
 * ONVIF adapter — STUB
 *
 * ONVIF Profile S/T/G uses SOAP over HTTP. Key services:
 *   Device service  (port 80)  → device info, capabilities
 *   Media service               → snapshot URI, stream URI
 *   PTZ service                 → pan/tilt/zoom
 *   AccessControl service       → door control (Profile A)
 *
 * ONVIF snapshot flow:
 *   1. GetSnapshotUri (Media service) → returns HTTP URI
 *   2. GET {uri} with WS-Security Digest auth → JPEG
 *
 * ONVIF door control (Profile A):
 *   AccessControl.AccessDoor(doorToken) → opens door
 *
 * TODO: Implement using the 'onvif' npm package or raw SOAP calls.
 *   Reference: ONVIF Core Specification 22.06, Profile A 1.0
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

export class ONVIFAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  async get_snapshot(): Promise<SnapshotResult> {
    // Step 1: GetSnapshotUri via SOAP
    // Step 2: fetch JPEG from the returned URI with WS-Security auth
    return this._notImplemented("get_snapshot", {
      success: false,
      captured_at: new Date(),
    });
  }

  async open_gate(): Promise<GateResult> {
    // Profile A: AccessControl.AccessDoor(gateToken)
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
    // Profile A: AccessControl.AccessDoor(doorToken)
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
    // GetDeviceInformation (Device Management Service)
    return this._notImplemented("get_status", {
      success: false,
      online: false,
      checked_at: new Date(),
    });
  }

  private _notImplemented<T extends object>(method: string, base: T): T {
    return {
      ...base,
      error: `ONVIF adapter: ${method}() is not yet implemented. Protocol: onvif`,
    };
  }
}
