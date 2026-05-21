/**
 * Hikvision ISAPI adapter (camera firmware only).
 *
 * Endpoints used:
 *   GET /ISAPI/Streaming/channels/{ch}/picture   → JPEG snapshot
 *   GET /ISAPI/System/deviceInfo                 → device metadata (XML)
 *   PUT /ISAPI/System/IO/outputs/{no}/trigger    → on-board I/O alarm relay
 *
 * NOTE: This adapter targets camera firmware only. Access-control firmware
 * profiles (e.g. DS-K1T344MX-E1) live in the Intercoms layer, not here.
 *
 * Auth: Basic → Digest MD5 fallback (RFC 7616)
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

function xmlField(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "i"));
  return m?.[1]?.trim() || undefined;
}

export class HikvisionAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  async get_snapshot(): Promise<SnapshotResult> {
    const captured_at = new Date();
    const ch = this.config.channel_no ?? 1;
    const channelPath = `/ISAPI/Streaming/channels/${ch}01/picture`;

    try {
      const res = await this.fetchCamera("GET", channelPath);

      if (!res.ok) {
        return {
          success: false,
          captured_at,
          error: `Camera returned HTTP ${res.status}`,
        };
      }

      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      const ext =
        contentType.includes("png") ? ".png"
        : contentType.includes("webp") ? ".webp"
        : ".jpg";

      const { url, size } = await this.saveImageBuffer(buffer, ext);
      const snapshot_base64 = `data:${contentType};base64,${buffer.toString("base64")}`;

      return {
        success: true,
        snapshot_url: url,
        snapshot_base64,
        mime_type: contentType,
        file_size_bytes: size,
        captured_at,
      };
    } catch (err: unknown) {
      return { success: false, captured_at, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Gate (on-board I/O relay output) ────────────────────────────────────────

  async open_gate(): Promise<GateResult> {
    const outputNo = this.config.gate_no ?? 1;
    try {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<IOPortData version="2.0">
  <outputState>trigger</outputState>
</IOPortData>`;
      const res = await this.fetchCamera(
        "PUT",
        `/ISAPI/System/IO/outputs/${outputNo}/trigger`,
        body,
        "application/xml",
      );
      const success = res.ok || res.status === 204;
      return {
        success,
        target_no: outputNo,
        mode: "io_relay",
        raw_status: res.status,
        ...(success ? {} : { error: `Camera returned HTTP ${res.status}` }),
      };
    } catch (err: unknown) {
      return {
        success: false,
        target_no: outputNo,
        mode: "io_relay",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  async get_status(): Promise<StatusResult> {
    const checked_at = new Date();
    const t0 = Date.now();

    try {
      const res = await this.fetchCamera("GET", "/ISAPI/System/deviceInfo");
      const latency_ms = Date.now() - t0;

      if (!res.ok) {
        return { online: false, checked_at, latency_ms, error: `Camera returned HTTP ${res.status}` };
      }

      const xml = await res.text();
      const device_info = {
        device_name:      xmlField(xml, "deviceName"),
        model:            xmlField(xml, "model"),
        serial_number:    xmlField(xml, "serialNumber"),
        firmware_version: xmlField(xml, "firmwareVersion"),
        hardware_version: xmlField(xml, "hardwareVersion"),
        mac_address:      xmlField(xml, "macAddress"),
        ipv4:             xmlField(xml, "ipAddress") ?? this.config.ip_address,
      };

      return { online: true, device_info, checked_at, latency_ms };
    } catch (err: unknown) {
      return {
        online: false,
        checked_at,
        latency_ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
