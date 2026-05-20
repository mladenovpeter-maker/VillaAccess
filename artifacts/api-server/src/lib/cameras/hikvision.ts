/**
 * Hikvision ISAPI adapter
 *
 * API reference: Hikvision ISAPI Reference Guide v2.x
 *
 * Endpoints used:
 *   GET  /ISAPI/Streaming/channels/{ch}/picture          → JPEG snapshot
 *   GET  /ISAPI/System/deviceInfo                        → device metadata (XML)
 *   PUT  /ISAPI/System/IO/outputs/{no}/trigger           → I/O relay trigger
 *   PUT  /ISAPI/AccessControl/RemoteControl/door/{no}    → access control door
 *
 * Authentication: Basic auth (fast path) → Digest MD5 fallback (RFC 7616)
 */

import type { CameraConfig, GateResult, SnapshotResult, StatusResult } from "./types";
import { BaseCameraAdapter } from "./base";

// ── XML helpers (no external dependency) ──────────────────────────────────────

function xmlField(xml: string, tag: string): string | undefined {
  // Handles <tag>value</tag> and namespaced <ns:tag>
  const m = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "i"));
  return m?.[1]?.trim() || undefined;
}

// ── HikvisionAdapter ──────────────────────────────────────────────────────────

export class HikvisionAdapter extends BaseCameraAdapter {
  constructor(config: CameraConfig) {
    super(config);
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  async get_snapshot(): Promise<SnapshotResult> {
    const captured_at = new Date();

    // Hikvision channel format: ch=1 → path segment "101" (channel 1, main stream)
    const ch = this.config.channel_no ?? 1;
    const channelPath = `/ISAPI/Streaming/channels/${ch}01/picture`;

    try {
      const res = await this.fetchCamera("GET", channelPath);

      if (!res.ok) {
        return {
          success: false,
          captured_at,
          raw_status: res.status,
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

      return {
        success: true,
        snapshot_url: url,
        mime_type: contentType,
        file_size_bytes: size,
        captured_at,
      };
    } catch (err: unknown) {
      return {
        success: false,
        captured_at,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Gate / Door ───────────────────────────────────────────────────────────

  private async _trigger(
    action: "gate" | "door",
    outputNo: number,
  ): Promise<GateResult> {
    const executed_at = new Date();
    const { use_access_control } = this.config;

    try {
      let res: Response;

      if (use_access_control) {
        // ── ISAPI AccessControl (DS-K panels, DS-2CD with face recognition) ──
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<RemoteControlDoor version="2.0">
  <cmd>open</cmd>
</RemoteControlDoor>`;
        res = await this.fetchCamera(
          "PUT",
          `/ISAPI/AccessControl/RemoteControl/door/${outputNo}`,
          body,
          "application/xml",
        );
      } else {
        // ── I/O alarm output relay (standard IP cameras) ──────────────────
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<IOPortData version="2.0">
  <outputState>trigger</outputState>
</IOPortData>`;
        res = await this.fetchCamera(
          "PUT",
          `/ISAPI/System/IO/outputs/${outputNo}/trigger`,
          body,
          "application/xml",
        );
      }

      return {
        success: res.ok || res.status === 204,
        action,
        command: "open",
        target_no: outputNo,
        mode: use_access_control ? "access_control" : "io_relay",
        executed_at,
        raw_status: res.status,
        ...(res.ok || res.status === 204
          ? {}
          : { error: `Camera returned HTTP ${res.status}` }),
      };
    } catch (err: unknown) {
      return {
        success: false,
        action,
        command: "open",
        target_no: outputNo,
        mode: use_access_control ? "access_control" : "io_relay",
        executed_at,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async open_gate(): Promise<GateResult> {
    return this._trigger("gate", this.config.gate_no ?? 1);
  }

  async open_door(): Promise<GateResult> {
    return this._trigger("door", this.config.door_no ?? 2);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async get_status(): Promise<StatusResult> {
    const checked_at = new Date();
    const t0 = Date.now();

    try {
      const res = await this.fetchCamera("GET", "/ISAPI/System/deviceInfo");
      const latency_ms = Date.now() - t0;

      if (!res.ok) {
        return {
          success: false,
          online: false,
          checked_at,
          latency_ms,
          error: `Camera returned HTTP ${res.status}`,
        };
      }

      const xml = await res.text();

      const device_info = {
        device_name: xmlField(xml, "deviceName"),
        model: xmlField(xml, "model"),
        serial_number: xmlField(xml, "serialNumber"),
        firmware_version: xmlField(xml, "firmwareVersion"),
        hardware_version: xmlField(xml, "hardwareVersion"),
        mac_address: xmlField(xml, "macAddress"),
        ipv4: xmlField(xml, "ipAddress") ?? this.config.ip_address,
      };

      return {
        success: true,
        online: true,
        device_info,
        checked_at,
        latency_ms,
      };
    } catch (err: unknown) {
      return {
        success: false,
        online: false,
        checked_at,
        latency_ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
