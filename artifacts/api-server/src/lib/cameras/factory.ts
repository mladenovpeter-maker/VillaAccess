/**
 * CameraFactory
 *
 * Creates the appropriate CameraAdapter from a DB camera record.
 * New protocols: add an import + case below.
 */

import type { CameraAdapter, CameraConfig, CameraProtocol } from "./types";
import { HikvisionAdapter } from "./hikvision";
import { DahuaAdapter } from "./dahua";
import { ONVIFAdapter } from "./onvif";
import { MockCameraAdapter } from "./mock";

/** Raw DB camera row shape (only the fields we need). */
export interface CameraRow {
  id: string;
  name: string;
  ip_address: string;
  http_port?: number | null;
  username?: string | null;
  password?: string | null;
  protocol?: string | null;
  channel_no?: number | null;
  gate_no?: number | null;
  rtsp_url?: string | null;
}

/** Normalise a DB row into a CameraConfig with safe defaults. */
export function buildConfig(row: CameraRow): CameraConfig {
  return {
    id: row.id,
    name: row.name,
    ip_address: row.ip_address,
    http_port: row.http_port ?? 80,
    username: row.username ?? "admin",
    password: row.password ?? "",
    protocol: (row.protocol ?? "hikvision") as CameraProtocol,
    channel_no: row.channel_no ?? 1,
    gate_no: row.gate_no ?? 1,
    rtsp_url: row.rtsp_url ?? undefined,
  };
}

/** Instantiate the correct adapter for a given camera row. */
export function createAdapter(row: CameraRow): CameraAdapter {
  const config = buildConfig(row);

  switch (config.protocol) {
    case "hikvision":
      return new HikvisionAdapter(config);
    case "dahua":
      return new DahuaAdapter(config);
    case "onvif":
      return new ONVIFAdapter(config);
    case "rtsp":
      // RTSP-only cameras: no snapshot/gate API — stub as ONVIF
      return new ONVIFAdapter({ ...config, protocol: "onvif" });
    case "mock":
      return new MockCameraAdapter(config);
    default:
      throw new Error(`Unknown camera protocol: "${config.protocol}"`);
  }
}
