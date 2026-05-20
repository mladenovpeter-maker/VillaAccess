import type { CameraAdapter, CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { saveMockSnapshot } from "../mock/snapshot-generator";

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export class MockCameraAdapter implements CameraAdapter {
  constructor(private config: CameraConfig) {}

  async get_snapshot(): Promise<SnapshotResult> {
    await delay(80 + Math.random() * 120);
    const confidence = Math.round((80 + Math.random() * 19) * 10) / 10;
    const plate = "-- LIVE MOCK --";
    try {
      const url = await saveMockSnapshot({
        plate,
        cameraName: this.config.name,
        confidence,
        detected: false,
      });
      return {
        success: true,
        snapshot_url: url,
        mime_type: "image/svg+xml",
        file_size_bytes: 4096,
        captured_at: new Date(),
      };
    } catch (err: any) {
      return { success: false, captured_at: new Date(), error: err.message };
    }
  }

  async open_gate(): Promise<GateResult> {
    await delay(120 + Math.random() * 80);
    return {
      success: true,
      action: "gate",
      command: "open",
      target_no: this.config.gate_no,
      mode: "io_relay",
      executed_at: new Date(),
    };
  }

  async open_door(): Promise<GateResult> {
    await delay(80 + Math.random() * 60);
    return {
      success: true,
      action: "door",
      command: "open",
      target_no: this.config.door_no,
      mode: "io_relay",
      executed_at: new Date(),
    };
  }

  async get_status(): Promise<StatusResult> {
    await delay(30 + Math.random() * 50);
    return {
      success: true,
      online: true,
      device_info: {
        device_name: `Mock Camera — ${this.config.name}`,
        model: "MOCK-DS-2CD2143G2",
        serial_number: `MOCK-${this.config.id.slice(0, 8).toUpperCase()}`,
        firmware_version: "V5.7.0 (mock)",
        hardware_version: "0x50",
        mac_address: "DE:AD:BE:EF:CA:FE",
        ipv4: this.config.ip_address,
      },
      checked_at: new Date(),
      latency_ms: Math.round(12 + Math.random() * 18),
    };
  }
}
