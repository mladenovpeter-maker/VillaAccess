const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function getToken() {
  return localStorage.getItem("access_token");
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("access_token");
    window.location.href = import.meta.env.BASE_URL + "login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ access_token: string; user: User }>("/auth/login", { username, password }),
  me: () => api.get<User>("/auth/me"),
  logout: () => api.post("/auth/logout", {}),
};

// Dashboard
export const dashboardApi = {
  stats: () => api.get<DashboardStats>("/dashboard/stats"),
  recentEvents: (limit = 20) => api.get<AccessEvent[]>(`/dashboard/recent-events?limit=${limit}`),
};

// Villas
export const villasApi = {
  list: () => api.get<Villa[]>("/villas"),
  get: (id: string) => api.get<Villa>(`/villas/${id}`),
  create: (body: Partial<Villa>) => api.post<Villa>("/villas", body),
  update: (id: string, body: Partial<Villa>) => api.put<Villa>(`/villas/${id}`, body),
};

// Reservations
export const reservationsApi = {
  list: (params?: { status?: string; villa_id?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<Reservation[]>(`/reservations${q ? "?" + q : ""}`);
  },
  get: (id: string) => api.get<Reservation>(`/reservations/${id}`),
  create: (body: Partial<Reservation>) => api.post<Reservation>("/reservations", body),
  update: (id: string, body: Partial<Reservation>) => api.put<Reservation>(`/reservations/${id}`, body),
  delete: (id: string) => api.delete(`/reservations/${id}`),
};

// Vehicles
export const vehiclesApi = {
  list: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<Vehicle[]>(`/vehicles${q ? "?" + q : ""}`);
  },
  get: (id: string) => api.get<Vehicle>(`/vehicles/${id}`),
  create: (body: Partial<Vehicle>) => api.post<Vehicle>("/vehicles", body),
  update: (id: string, body: Partial<Vehicle>) => api.put<Vehicle>(`/vehicles/${id}`, body),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  events: (id: string) => api.get<{ items: AccessEvent[]; total: number }>(`/vehicles/${id}/events`),
};

// Access
export const accessApi = {
  events: (params?: { status?: string; villa_id?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<PaginatedEvents>(`/access/events${q ? "?" + q : ""}`);
  },
  openGate: (villa_id: string, notes?: string) => api.post("/access/open-gate", { villa_id, notes }),
  openDoor: (villa_id: string, notes?: string) => api.post("/access/open-door", { villa_id, notes }),
};

// Cameras
export const camerasApi = {
  list: () => api.get<Camera[]>("/cameras"),
};

// Logs
export const logsApi = {
  list: (params?: { log_type?: string; villa_id?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<PaginatedLogs>(`/logs${q ? "?" + q : ""}`);
  },
};

// Types
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
  gate_id: string;
  door_id: string;
  camera_ids: string[];
  status: string;
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
}

export interface Vehicle {
  id: string;
  license_plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  vehicle_type: string | null;
  confidence_score: number | null;
  status: string;
  snapshot_url: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_visits: number;
  notes: string | null;
}

export interface AccessEvent {
  id: string;
  timestamp: string;
  event_type: string;
  status: string;
  confidence_score: number | null;
  vehicle_id: string | null;
  license_plate: string | null;
  villa_id: string | null;
  camera_id: string | null;
  snapshot_url: string | null;
  notes: string | null;
  vehicle: Vehicle | null;
  villa: Villa | null;
}

export interface Camera {
  id: string;
  name: string;
  ip_address: string;
  rtsp_url: string | null;
  villa_id: string | null;
  status: string;
  last_snapshot: string | null;
  snapshot_url: string | null;
  model: string | null;
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
