// ─── Camera adapter types ──────────────────────────────────────────────────────
// Unified interface for Hikvision ISAPI, Dahua SDK, and ONVIF cameras.

export type CameraProtocol = "hikvision" | "dahua" | "onvif" | "rtsp" | "mock";

/** All configuration needed to connect to a physical camera. */
export interface CameraConfig {
  id: string;
  name: string;
  ip_address: string;
  http_port: number;           // default 80
  username: string;            // default "admin"
  password: string;
  protocol: CameraProtocol;
  channel_no: number;          // video channel (1-based), default 1
  // Access control
  use_access_control: boolean; // true → ISAPI AccessControl door; false → I/O relay
  gate_no: number;             // door/relay number for gate (default 1)
  door_no: number;             // door/relay number for side door (default 2)
  // Optional
  rtsp_url?: string;
}

// ─── Result types ──────────────────────────────────────────────────────────────

export interface SnapshotResult {
  success: boolean;
  snapshot_url?: string;       // local /api/uploads/... URL after saving
  mime_type?: string;
  file_size_bytes?: number;
  captured_at: Date;
  error?: string;
  raw_status?: number;
}

export interface GateResult {
  success: boolean;
  action: "gate" | "door";
  command: "open";
  target_no: number;
  mode: "io_relay" | "access_control";
  executed_at: Date;
  error?: string;
  raw_status?: number;
}

export interface DeviceInfo {
  device_name?: string;
  model?: string;
  serial_number?: string;
  firmware_version?: string;
  hardware_version?: string;
  mac_address?: string;
  ipv4?: string;
}

export interface StatusResult {
  success: boolean;
  online: boolean;
  device_info?: DeviceInfo;
  checked_at: Date;
  latency_ms?: number;
  error?: string;
}

// ─── Unified adapter interface ─────────────────────────────────────────────────

export interface CameraAdapter {
  /** Fetch a JPEG snapshot from the camera and store it locally. */
  get_snapshot(): Promise<SnapshotResult>;

  /** Trigger the gate relay or AccessControl gate door. */
  open_gate(): Promise<GateResult>;

  /** Trigger the door relay or AccessControl side door. */
  open_door(): Promise<GateResult>;

  /** Ping the camera and retrieve device information. */
  get_status(): Promise<StatusResult>;
}
