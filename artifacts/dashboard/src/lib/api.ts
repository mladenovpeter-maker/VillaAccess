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
  snapshot: (id: string) => api.get<CameraActionResult>(`/cameras/${id}/snapshot`),
  status: (id: string) => api.get<CameraStatusResult>(`/cameras/${id}/status`),
  gate: (id: string) => api.post<CameraActionResult>(`/cameras/${id}/gate`, {}),
};

export const logsApi = {
  list: (params?: {
    log_type?: string;
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
  active_entrances: number;
  total_vehicles: number;
  events_today: number;
  gates_online: number;
  cameras_online: number;
  denied_attempts_today: number;
  auto_opens_today: number;
}

export interface Entrance {
  id: string;
  name: string;
  access_level: "public" | "restricted" | "admin_only";
  description: string | null;
  active: boolean;
  camera_count?: number;
  intercom_count?: number;
  created_at?: string;
  updated_at?: string;
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

export interface Camera {
  id: string;
  name: string;
  ip_address: string;
  rtsp_url: string | null;
  entrance_id: string | null;
  model: string | null;
  protocol: "hikvision" | "dahua" | "onvif" | "rtsp";
  http_port: number;
  username: string;
  channel_no: number;
  gate_no: number;
  status: "online" | "offline" | "error";
  last_snapshot: string | null;
  snapshot_url: string | null;
  last_status_check: string | null;
  last_status_latency_ms: number | null;
  device_info: CameraDeviceInfo | null;
  ocr_enabled: boolean;
  polling_interval_ms: number;
  ocr_min_confidence: number;
  anpr_cooldown_seconds: number;
  last_anpr_plate: string | null;
  last_anpr_at: string | null;
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
  operator_id: string | null;
  snapshot_url: string | null;
  confidence_score: number | null;
}

// ─── Domain events (SSE + history) ───────────────────────────────────────────

export interface DomainEvent {
  id: string;
  event_type: string;
  category: string;
  severity: "info" | "warning" | "error" | "critical";
  timestamp: string;
  source: string;
  payload: Record<string, unknown> | null;
}

export interface EventStats {
  total: number;
  by_category: Record<string, number>;
  last_24h: number;
  per_day: number;
}

export interface PaginatedDomainEvents {
  items: DomainEvent[];
  total: number;
  page: number;
  page_size: number;
}

export const eventsApi = {
  streamUrl: (token: string, category?: string): string => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
    const params = new URLSearchParams({ token });
    if (category) params.set("category", category);
    return `${base}/events/stream?${params.toString()}`;
  },
  stats: () => api.get<EventStats>("/events/stats"),
  list: (params?: { category?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<PaginatedDomainEvents>(`/events${q ? "?" + q : ""}`);
  },
};
