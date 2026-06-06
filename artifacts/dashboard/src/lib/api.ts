const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ─── Token storage ────────────────────────────────────────────────────────────

const KEYS = {
  access: "access_token",
  refresh: "refresh_token",
  user: "auth_user",
} as const;

export const tokenStore = {
  getAccess: () => localStorage.getItem(KEYS.access),
  getRefresh: () => localStorage.getItem(KEYS.refresh),
  getUser: (): User | null => {
    try {
      const raw = localStorage.getItem(KEYS.user);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  },
  set: (access: string, refresh: string, user: User) => {
    localStorage.setItem(KEYS.access, access);
    localStorage.setItem(KEYS.refresh, refresh);
    localStorage.setItem(KEYS.user, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(KEYS.access);
    localStorage.removeItem(KEYS.refresh);
    localStorage.removeItem(KEYS.user);
  },
};

// ─── Token expiry check ───────────────────────────────────────────────────────

function isTokenExpiredOrSoon(token: string, bufferSeconds = 60): boolean {
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    return payload.exp * 1000 < Date.now() + bufferSeconds * 1000;
  } catch {
    return true;
  }
}

// ─── Refresh lock (prevents parallel refresh races) ───────────────────────────

let _refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) {
        tokenStore.clear();
        return null;
      }

      const data: { access_token: string; refresh_token: string } =
        await res.json();
      const user = tokenStore.getUser();
      if (user) {
        tokenStore.set(data.access_token, data.refresh_token, user);
      }
      return data.access_token;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ─── Core fetch with auto-refresh ─────────────────────────────────────────────

async function request<T>(
  path: string,
  options?: RequestInit,
  _retry = true
): Promise<T> {
  let token = tokenStore.getAccess();

  // Proactively refresh if token is expiring within 60 seconds
  if (token && isTokenExpiredOrSoon(token)) {
    token = await refreshAccessToken();
  }

  if (!token && path !== "/auth/login" && path !== "/auth/refresh") {
    redirectToLogin();
    throw new Error("No access token");
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  // 401 → try refresh once, then give up
  if (res.status === 401 && _retry && path !== "/auth/refresh") {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(path, options, false);
    redirectToLogin();
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const error = new Error(err.detail || res.statusText) as Error & Record<string, unknown>;
    Object.assign(error, err);
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

function redirectToLogin() {
  tokenStore.clear();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (!window.location.pathname.endsWith("/login")) {
    window.location.href = base + "/login";
  }
}

// ─── Public API surface ───────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ─── Auth API ─────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  refresh: (refresh_token: string) =>
    request<{ access_token: string; refresh_token: string }>(
      "/auth/refresh",
      { method: "POST", body: JSON.stringify({ refresh_token }) },
      false
    ),
  me: () => api.get<User>("/auth/me"),
  logout: (refresh_token?: string) =>
    api.post("/auth/logout", refresh_token ? { refresh_token } : {}),
};

// ─── Resource APIs ────────────────────────────────────────────────────────────

export const dashboardApi = {
  stats: () => api.get<DashboardStats>("/dashboard/stats"),
  recentEvents: (
    limit = 20,
    opts?: { status?: string; event_type?: string },
  ) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (opts?.status) p.set("status", opts.status);
    if (opts?.event_type) p.set("event_type", opts.event_type);
    return api.get<AccessEvent[]>(`/dashboard/recent-events?${p.toString()}`);
  },
};

export const villasApi = {
  list: () => api.get<Villa[]>("/villas"),
  get: (id: string) => api.get<Villa>(`/villas/${id}`),
  create: (body: Partial<Villa>) => api.post<Villa>("/villas", body),
  update: (id: string, body: Partial<Villa>) =>
    api.put<Villa>(`/villas/${id}`, body),
};

export const reservationsApi = {
  list: (params?: { status?: string; villa_id?: string }) => {
    const q = new URLSearchParams(
      params as Record<string, string>
    ).toString();
    return api.get<Reservation[]>(`/reservations${q ? "?" + q : ""}`);
  },
  get: (id: string) => api.get<Reservation>(`/reservations/${id}`),
  create: (body: Partial<Reservation>) =>
    api.post<Reservation>("/reservations", body),
  update: (id: string, body: Partial<Reservation>) =>
    api.put<Reservation>(`/reservations/${id}`, body),
  delete: (id: string) => api.delete(`/reservations/${id}`),
  checkIn:  (id: string) => api.post<Reservation>(`/reservations/${id}/check-in`, {}),
  checkOut: (id: string) => api.post<Reservation>(`/reservations/${id}/check-out`, {}),
  cancel:   (id: string, reason?: string) => api.post<Reservation>(`/reservations/${id}/cancel`, { reason }),
  regeneratePin: (id: string) => api.post<Reservation & { sync_result: unknown }>(`/reservations/${id}/regenerate-pin`, {}),
  forceSync:     (id: string) => api.post<Reservation & { sync_result: unknown }>(`/reservations/${id}/force-sync`, {}),
  revokePin:     (id: string) => api.post<Reservation & { sync_result: unknown }>(`/reservations/${id}/revoke-pin`, {}),
  accessWindow:  (id: string) => api.get(`/reservations/${id}/access-window`),
  emailStatus:   () => api.get<{ configured: boolean }>(`/reservations/email-status`),
  sendEmail:     (id: string, lang: "bg" | "en") =>
    api.post<{ ok: boolean; sent_to: string }>(`/reservations/${id}/send-email`, { lang }),
};

export const vehiclesApi = {
  list: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams(
      params as Record<string, string>
    ).toString();
    return api.get<Vehicle[]>(`/vehicles${q ? "?" + q : ""}`);
  },
  get: (id: string) => api.get<Vehicle>(`/vehicles/${id}`),
  create: (body: Partial<Vehicle>) => api.post<Vehicle>("/vehicles", body),
  update: (id: string, body: Partial<Vehicle>) =>
    api.put<Vehicle>(`/vehicles/${id}`, body),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  events: (id: string, page = 1, page_size = 20) =>
    api.get<PaginatedEvents>(
      `/vehicles/${id}/events?page=${page}&page_size=${page_size}`
    ),
  snapshots: (id: string, page = 1, page_size = 20) =>
    api.get<PaginatedSnapshots>(
      `/vehicles/${id}/snapshots?page=${page}&page_size=${page_size}`
    ),
  addSnapshot: (id: string, body: Partial<VehicleSnapshot> & { snapshot_url: string }) =>
    api.post<VehicleSnapshot>(`/vehicles/${id}/snapshots`, body),
  blacklist: (id: string, reason: string) =>
    api.patch<Vehicle>(`/vehicles/${id}/blacklist`, { reason }),
  unblacklist: (id: string) =>
    api.patch<Vehicle>(`/vehicles/${id}/unblacklist`, {}),
  updateFingerprint: (id: string, fingerprint: AiFingerprint & { ocr_candidates: string[] }) =>
    api.patch(`/vehicles/${id}/fingerprint`, fingerprint),
};

export const accessApi = {
  events: (params?: {
    status?: string;
    entrance_id?: string;
    page?: number;
    page_size?: number;
  }) => {
    const q = new URLSearchParams(
      params as Record<string, string>
    ).toString();
    return api.get<PaginatedEvents>(`/access/events${q ? "?" + q : ""}`);
  },
  openGate: (entrance_id: string, notes?: string) =>
    api.post("/access/open-gate", { entrance_id, notes }),
  openDoor: (entrance_id: string, notes?: string) =>
    api.post("/access/open-door", { entrance_id, notes }),
};

export const entrancesApi = {
  list: () => api.get<Entrance[]>("/entrances"),
  get: (id: string) => api.get<Entrance>(`/entrances/${id}`),
  create: (body: Partial<Entrance>) => api.post<Entrance>("/entrances", body),
  update: (id: string, body: Partial<Entrance>) => api.put<Entrance>(`/entrances/${id}`, body),
  delete: (id: string) => api.delete(`/entrances/${id}`),
};

export const smartLocksApi = {
  list:   () => api.get<SmartLock[]>("/locks"),
  get:    (id: string) => api.get<SmartLock>(`/locks/${id}`),
  create: (body: Partial<SmartLock> & { name: string; tuya_device_id?: string | null; villa_id?: string | null; protocol?: "tuya" }) =>
            api.post<SmartLock>("/locks", body),
  update: (id: string, body: Partial<Pick<SmartLock, "name" | "villa_id" | "tuya_device_id">>) =>
            api.patch<SmartLock>(`/locks/${id}`, body),
  delete: (id: string) => api.delete(`/locks/${id}`),
  status: (id: string) =>
            api.get<{ online: boolean; battery_pct: number | null; last_seen_at: string | null; latency_ms: number }>(`/locks/${id}/status`),
  events: (id: string, page = 1, page_size = 20) =>
            api.get<{ records: SmartLockEvent[]; page: number; page_size: number; count: number }>(
              `/locks/${id}/events?page=${page}&page_size=${page_size}`,
            ),
};

export const intercomsApi = {
  list: () => api.get<Intercom[]>("/intercoms"),
  get: (id: string) => api.get<Intercom>(`/intercoms/${id}`),
  create: (body: Partial<Intercom>) => api.post<Intercom>("/intercoms", body),
  update: (id: string, body: Partial<Intercom>) => api.patch<Intercom>(`/intercoms/${id}`, body),
  delete: (id: string) => api.delete(`/intercoms/${id}`),
  open: (id: string) => api.post(`/intercoms/${id}/open`, {}),
  testConnectivity: (id: string) => api.post(`/intercoms/${id}/test-connectivity`, {}),
  testPinSync: (id: string) => api.post(`/intercoms/${id}/test-pin-sync`, {}),
};

export const camerasApi = {
  list: () => api.get<Camera[]>("/cameras"),
  get: (id: string) => api.get<Camera>(`/cameras/${id}`),
  create: (data: Partial<Camera> & { name: string; ip_address: string }) =>
    api.post<Camera>("/cameras", data),
  update: (id: string, data: Partial<Camera>) =>
    api.patch<Camera>(`/cameras/${id}`, data),
  delete: (id: string) => api.delete(`/cameras/${id}`),
  // Live camera actions — delegate to the adapter layer
  snapshot: (id: string) => api.get<CameraActionResult>(`/cameras/${id}/snapshot`),
  status: (id: string) => api.get<CameraStatusResult>(`/cameras/${id}/status`),
  gate: (id: string) => api.post<CameraActionResult>(`/cameras/${id}/gate`, {}),
};

export const logsApi = {
  list: (params?: {
    log_type?: string;
    villa_id?: string;
    page?: number;
    page_size?: number;
  }) => {
    const q = new URLSearchParams(
      params as Record<string, string>
    ).toString();
    return api.get<PaginatedLogs>(`/logs${q ? "?" + q : ""}`);
  },
};

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  role: string;
  full_name: string | null;
}

export interface DashboardStats {
  total_villas: number;
  active_reservations: number;
  total_vehicles: number;
  events_today: number;
  gates_online: number;
  cameras_online: number;
  denied_attempts_today: number;
  auto_opens_today: number;
}

export interface Villa {
  id: string;
  name: string;
  status: string;
  active_reservations?: number;
}

export interface AssignedIntercom {
  id: string;
  name: string;
  ip_address: string;
  protocol: string;
  pin_sync_enabled: boolean;
  last_sync_status: string | null;
  last_sync_at: string | null;
  status: string;
  entrance_id: string | null;
}

export interface Reservation {
  id: string;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  villa_id: string;
  villa: Villa | null;
  check_in: string;
  check_out: string;
  status: string;
  vehicle_ids: string[];
  vehicles: Vehicle[];
  notes: string | null;
  pin_code: string | null;
  pin_valid_from: string | null;
  pin_valid_to: string | null;
  pin_sync_status: "pending" | "synced" | "failed" | "revoked" | "not_applicable";
  pin_last_synced_at: string | null;
  assigned_intercoms: AssignedIntercom[];
  actual_check_in: string | null;
  actual_check_out: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Intercom {
  id: string;
  name: string;
  entrance_id: string | null;
  ip_address: string;
  http_port: number;
  username: string;
  protocol: "hikvision" | "dahua" | "sip" | "generic";
  device_type: string | null;
  relay_no: number;
  door_count: number;
  lock_type: string | null;
  pin_support: boolean;
  schedule_support: boolean;
  pin_sync_enabled: boolean;
  last_sync_status: string | null;
  last_sync_at: string | null;
  status: "online" | "offline" | "error";
  last_status_check: string | null;
  last_status_latency_ms: number | null;
  device_info: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmartLock {
  id: string;
  name: string;
  villa_id: string | null;
  protocol: "tuya";
  tuya_device_id: string | null;
  status: "online" | "offline" | "error" | "unknown";
  battery_pct: number | null;
  last_seen: string | null;
  last_status_check: string | null;
  last_status_latency_ms: number | null;
  device_info: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SmartLockEvent {
  /** Tuya record id when available */
  id?: string | number;
  /** Event time in ms since epoch (Tuya `event_time`) or ISO string */
  event_time?: number | string;
  /** Tuya numeric event_id (1=fingerprint, 2=password, 6=app, etc.) */
  event_id?: number;
  /** Friendly description if backend enriches it */
  event_type?: string;
  user_name?: string | null;
  operator?: string | null;
  source?: string | null;
  [k: string]: unknown;
}

export interface AiFingerprint {
  embedding: number[];
  model_version: string;
  extracted_at: string;
  plate_confidence: number;
  vehicle_confidence: number;
  ocr_candidates: string[];
  color_histogram?: number[];
}

export interface Vehicle {
  id: string;
  license_plate: string;
  plate_region: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  vehicle_type: string | null;
  owner_name: string | null;
  ai_fingerprint: AiFingerprint | null;
  confidence_score: number | null;
  status: string;
  access_type: "reservation" | "permanent";
  blacklist_reason: string | null;
  blacklisted_at: string | null;
  blacklisted_by: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_visits: number;
  snapshot_url: string | null;
  thumbnail_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleSnapshot {
  id: string;
  vehicle_id: string;
  access_event_id: string | null;
  camera_id: string | null;
  snapshot_url: string;
  thumbnail_url: string | null;
  plate_crop_url: string | null;
  confidence_score: number | null;
  ocr_text: string | null;
  ai_annotations: Record<string, unknown> | null;
  is_primary: boolean;
  captured_at: string;
}

export interface PaginatedSnapshots {
  items: VehicleSnapshot[];
  total: number;
  page: number;
  page_size: number;
}

export interface Entrance {
  id: string;
  name: string;
  /** Legacy: mirrors villa_ids[0] for back-compat. Prefer villa_ids[]. */
  villa_id: string | null;
  /** M:N source of truth (Phase A.2). One row per villa allowed at this entrance. */
  villa_ids: string[];
  description: string | null;
  active: boolean;
  camera_count?: number;
  intercom_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AccessEvent {
  id: string;
  timestamp: string;
  event_type: string;
  status: string;
  confidence_score: number | null;
  vehicle_id: string | null;
  license_plate: string | null;
  entrance_id: string | null;
  camera_id: string | null;
  snapshot_url: string | null;
  notes: string | null;
  vehicle: Vehicle | null;
  entrance: Entrance | null;
}

export interface Camera {
  id: string;
  name: string;
  ip_address: string;
  rtsp_url: string | null;
  entrance_id: string | null;
  model: string | null;
  // Integration
  protocol: "hikvision" | "dahua" | "onvif" | "rtsp";
  http_port: number;
  username: string;
  channel_no: number;
  gate_no: number;
  // Runtime state
  status: "online" | "offline" | "error";
  last_snapshot: string | null;
  snapshot_url: string | null;
  last_status_check: string | null;
  last_status_latency_ms: number | null;
  device_info: CameraDeviceInfo | null;
  // ANPR / OCR (V1)
  ocr_enabled: boolean;
  polling_interval_ms: number;
  ocr_min_confidence: number;
  anpr_cooldown_seconds: number;
  last_anpr_plate: string | null;
  last_anpr_at: string | null;
  // Fuzzy / partial plate matching (additive, default OFF)
  allow_partial_match: boolean;
  partial_match_threshold: number;
  partial_min_confidence: number;
  min_matching_digits: number;
  created_at: string;
  updated_at: string;
}

export interface CameraDeviceInfo {
  device_name?: string;
  model?: string;
  serial_number?: string;
  firmware_version?: string;
  hardware_version?: string;
  mac_address?: string;
  ipv4?: string;
}

export interface CameraActionResult {
  camera_id: string;
  camera_name: string;
  success: boolean;
  snapshot_url?: string;
  /** Inline data URL ("data:image/jpeg;base64,..."); preferred over snapshot_url for live preview. */
  snapshot_base64?: string;
  action?: string;
  command?: string;
  target_no?: number;
  mode?: string;
  executed_at?: string;
  captured_at?: string;
  error?: string;
  raw_status?: number;
}

export interface CameraStatusResult {
  camera_id: string;
  camera_name: string;
  success: boolean;
  online: boolean;
  device_info?: CameraDeviceInfo;
  checked_at: string;
  latency_ms?: number;
  error?: string;
}

export interface PaginatedEvents {
  items: AccessEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface PaginatedLogs {
  items: LogEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  log_type: string;
  message: string;
  vehicle_id: string | null;
  villa_id: string | null;
  operator_id: string | null;
  snapshot_url: string | null;
  confidence_score: number | null;
}

// ─── Domain Events ────────────────────────────────────────────────────────────

export interface DomainEvent {
  id: string;
  event_type: string;
  category: "vehicle" | "gate" | "access" | "ai" | "reservation";
  severity: "info" | "warning" | "error" | "critical";
  payload: Record<string, unknown> | null;
  vehicle_id: string | null;
  entrance_id: string | null;
  camera_id: string | null;
  reservation_id: string | null;
  operator_id: string | null;
  source: string;
  created_at: string;
}

export interface PaginatedEvents {
  items: DomainEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface EventStats {
  period: string;
  total: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  sse_clients: number;
}

// Events endpoints reuse the shared `request` helper (bearer auth + 401 refresh).
function authedFetch<T>(path: string): Promise<T> {
  return request<T>(path);
}

export const eventsApi = {
  list: (params?: {
    category?: string;
    event_type?: string;
    severity?: string;
    vehicle_id?: string;
    entrance_id?: string;
    camera_id?: string;
    source?: string;
    since?: string;
    until?: string;
    page?: number;
    page_size?: number;
  }) => {
    const entries = Object.entries(params ?? {}).filter(
      ([, v]) => v !== undefined && v !== "" && v !== null,
    );
    const qs = entries.length
      ? `?${new URLSearchParams(entries as [string, string][]).toString()}`
      : "";
    return authedFetch<PaginatedEvents>(`/events${qs}`);
  },

  stats: () => authedFetch<EventStats>("/events/stats"),

  streamUrl: (token: string, category?: string): string => {
    const params = new URLSearchParams({ token });
    if (category && category !== "all") params.set("category", category);
    return `${BASE}/events/stream?${params.toString()}`;
  },
};
