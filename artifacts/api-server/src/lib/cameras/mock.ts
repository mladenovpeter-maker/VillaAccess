import path from "path";
import { promises as fs } from "fs";
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

      // Read the just-written SVG back from disk and inline it as a data URL.
      // The url may be absolute (PUBLIC_UPLOADS_URL set) or relative; either
      // way we can recover the on-disk path from the "/api/uploads/..." suffix.
      let snapshot_base64: string | undefined;
      try {
        const m = url.match(/\/api\/uploads\/(.+)$/);
        if (m) {
          const abs = path.join(process.cwd(), "uploads", m[1]);
          const buf = await fs.readFile(abs);
          snapshot_base64 = `data:image/svg+xml;base64,${buf.toString("base64")}`;
        }
      } catch {
        /* inline preview is best-effort; fall back to snapshot_url */
      }

      return {
        success: true,
        snapshot_url: url,
        snapshot_base64,
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
      target_no: this.config.gate_no,
      mode: "io_relay",
    };
  }

  async get_status(): Promise<StatusResult> {
    await delay(30 + Math.random() * 50);
    return {
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
