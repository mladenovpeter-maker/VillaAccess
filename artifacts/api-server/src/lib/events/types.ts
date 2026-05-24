// ─── Event catalog ────────────────────────────────────────────────────────────

export type EventCategory = "vehicle" | "gate" | "access" | "ai" | "reservation";
export type EventSeverity  = "info" | "warning" | "error" | "critical";
export type EventSource    = "dashboard" | "camera" | "ai_worker" | "api" | "mock";

export type EventType =
  // ── Vehicle ────────────────────────────────────────────────────────────────
  | "vehicle.created"
  | "vehicle.updated"
  | "vehicle.detected"           // camera/AI spotted a vehicle
  | "vehicle.recognized"         // matched to existing record
  | "vehicle.unrecognized"       // not found in database
  | "vehicle.blacklisted"
  | "vehicle.unblacklisted"
  // ── Gate ───────────────────────────────────────────────────────────────────
  | "gate.opened"                // gate relay triggered successfully
  | "gate.failed"                // gate relay failed
  | "gate.door_opened"           // side-door relay triggered
  | "gate.door_failed"
  // ── Access ─────────────────────────────────────────────────────────────────
  | "access.granted"             // vehicle allowed entry
  | "access.denied"              // vehicle denied (blacklisted, unknown, etc.)
  | "access.manual_override"     // operator opened manually from dashboard
  // ── AI recognition ─────────────────────────────────────────────────────────
  | "ai.snapshot_uploaded"       // snapshot ingested via upload endpoint
  | "ai.plate_read"              // OCR completed by AI worker
  | "ai.confidence_low"          // recognition below threshold
  | "ai.fingerprint_updated"     // AI fingerprint/embedding stored
  | "ai.recognition_complete"    // full AI pipeline finished
  | "ai.ocr_scan"                // raw OCR scan (simulator / AI worker)
  | "ai.fallback_allowed"        // GPT fallback after N OCR fails → gate opened
  | "ai.fallback_denied"         // GPT fallback after N OCR fails → denied / no-op
  // ── Reservation ────────────────────────────────────────────────────────────
  | "reservation.created"
  | "reservation.updated"
  | "reservation.checked_in"
  | "reservation.checked_out"
  | "reservation.cancelled"
  | "reservation.expired";

// ── Category inference lookup ────────────────────────────────────────────────

export const EVENT_CATEGORY_MAP: Record<EventType, EventCategory> = {
  "vehicle.created":           "vehicle",
  "vehicle.updated":           "vehicle",
  "vehicle.detected":          "vehicle",
  "vehicle.recognized":        "vehicle",
  "vehicle.unrecognized":      "vehicle",
  "vehicle.blacklisted":       "vehicle",
  "vehicle.unblacklisted":     "vehicle",
  "gate.opened":               "gate",
  "gate.failed":               "gate",
  "gate.door_opened":          "gate",
  "gate.door_failed":          "gate",
  "access.granted":            "access",
  "access.denied":             "access",
  "access.manual_override":    "access",
  "ai.snapshot_uploaded":      "ai",
  "ai.plate_read":             "ai",
  "ai.confidence_low":         "ai",
  "ai.fingerprint_updated":    "ai",
  "ai.recognition_complete":   "ai",
  "ai.ocr_scan":               "ai",
  "ai.fallback_allowed":       "ai",
  "ai.fallback_denied":        "ai",
  "reservation.created":       "reservation",
  "reservation.updated":       "reservation",
  "reservation.checked_in":    "reservation",
  "reservation.checked_out":   "reservation",
  "reservation.cancelled":     "reservation",
  "reservation.expired":       "reservation",
};

// ── Payload types per event ──────────────────────────────────────────────────

export interface GatePayload {
  action: "gate" | "door";
  mode: "io_relay" | "access_control";
  target_no: number;
  triggered_by?: string;
  success: boolean;
  error?: string;
}

export interface VehiclePayload {
  license_plate: string;
  status?: string;
  make?: string;
  model?: string;
  confidence_score?: number;
  reason?: string;
}

export interface AccessPayload {
  license_plate?: string;
  decision: "granted" | "denied" | "override";
  reason?: string;
  confidence_score?: number;
}

export interface AIPayload {
  snapshot_url?: string;
  ocr_text?: string;
  confidence_score?: number;
  model_version?: string;
  ocr_status?: string;
}

export interface ReservationPayload {
  guest_name: string;
  check_in?: string;
  check_out?: string;
  status?: string;
  villa_name?: string;
}

// ── Event input (what routes publish) ────────────────────────────────────────

export interface DomainEventInput {
  event_type: EventType;
  severity?: EventSeverity;
  payload?: Record<string, unknown>;
  // optional refs
  vehicle_id?:    string | null;
  entrance_id?:   string | null;   // shared entrance where event occurred
  camera_id?:     string | null;
  reservation_id?: string | null;
  operator_id?:   string | null;
  // metadata
  source?: EventSource | string;
  ip_address?: string | null;
}

// ── Full persisted + broadcast event ─────────────────────────────────────────

export interface DomainEvent extends DomainEventInput {
  id: string;
  category: EventCategory;
  severity: EventSeverity;
  created_at: string; // ISO-8601
}
