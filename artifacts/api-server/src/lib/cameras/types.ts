/**
 * Camera adapter contract.
 *
 * Cameras handle imaging (snapshots, ping/status) and an optional on-board
 * I/O relay output (`gate_no`). Access-control / PIN / door-release flows
 * belong to the Intercoms layer, NOT to camera adapters.
 */

export type CameraProtocol = "hikvision" | "dahua" | "onvif" | "rtsp" | "mock";

export interface CameraConfig {
  id: string;
  name: string;
  ip_address: string;
  http_port: number;
  username: string;
  password: string;
  protocol: CameraProtocol;
  channel_no: number;
  gate_no: number;       // on-board relay output number (default 1)
  rtsp_url?: string;
}

// ─── Result shapes ────────────────────────────────────────────────────────────

export interface SnapshotResult {
  success: boolean;
  snapshot_url?: string;
  /**
   * Inline data URL of the snapshot ("data:image/jpeg;base64,...").
   * Returned by the snapshot endpoint so the frontend can render the
   * preview without touching nginx / static routing / proxy quirks.
   * Not persisted to the database.
   */
  snapshot_base64?: string;
  mime_type?: string;
  file_size_bytes?: number;
  captured_at?: Date;
  error?: string;
}

export interface StatusResult {
  online: boolean;
  latency_ms?: number;
  checked_at: Date;
  error?: string;
  device_info?: {
    device_name?: string;
    model?: string;
    serial_number?: string;
    firmware_version?: string;
    hardware_version?: string;
    mac_address?: string;
    ipv4?: string;
  };
}

export interface GateResult {
  success: boolean;
  target_no?: number;
  mode?: "io_relay" | "stub";
  error?: string;
  raw_status?: number;
}

export interface CameraAdapter {
  get_snapshot(): Promise<SnapshotResult>;
  get_status(): Promise<StatusResult>;
  /** Trigger the on-board I/O relay output to pulse a gate. */
  open_gate(): Promise<GateResult>;
}
