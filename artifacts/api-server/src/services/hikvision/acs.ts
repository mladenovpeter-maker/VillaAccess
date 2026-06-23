/**
 * Hikvision ACS (Access Control System) Service
 *
 * Manages card-based worker access on Hikvision ASC3202B controllers via ISAPI.
 *
 * ISAPI endpoints used:
 *   GET  /ISAPI/System/deviceInfo                             → connectivity test
 *   PUT  /ISAPI/AccessControl/timeTemplates?format=json       → create/update time template
 *   PUT  /ISAPI/AccessControl/UserInfo/SetUp?format=json      → create/update card user
 *   PUT  /ISAPI/AccessControl/CardInfo/SetUp?format=json      → attach card to user (fallback)
 *   PUT  /ISAPI/AccessControl/UserInfo/Delete?format=json     → remove card user
 *   POST /ISAPI/AccessControl/UserInfo/Search?format=json     → list users on device
 *   PUT  /ISAPI/AccessControl/antiPassback?format=json        → configure anti-passback
 *
 * Template slot 1 is always reserved by device as "24/7 always".
 * Custom shifts start from slot 2 (stored as shifts.hik_template_no).
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ACSConfig {
  id: string;
  name: string;
  ip_address: string;
  http_port: number;
  username: string;
  password: string;
  relay_no: number;
}

export interface ShiftTemplate {
  hik_template_no: number;      // 2..N
  name: string;
  start_time: string;           // "HH:MM"
  end_time: string;             // "HH:MM"
  days_of_week: number[];       // JS [0=Sun..6=Sat]
}

export interface CardUserParams {
  employeeNo: string;           // numeric string, max 9 digits
  name: string;
  cardNo: string;               // decimal string (converted from HEX badge_no)
  doorNo: number;               // relay_no on this device
  templateNo: number;           // 1 = always; 2..N = shift
}

export interface SyncWorkerInput {
  employee_number: string | null;
  id: string;
  first_name: string;
  last_name: string;
  badge_no: string | null;
  shift_id: string | null;
}

export interface HikResult {
  success: boolean;
  error?: string;
  raw_status?: number;
  upstream_body?: string;
}

export interface FullSyncResult {
  device: string;
  total: number;
  synced: number;
  skipped: number;   // workers without badge_no
  failed: { employeeNo: string; name: string; error: string }[];
  template_errors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HIK_DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Convert HEX badge_no to decimal string expected by Hikvision ISAPI. */
export function hikCardNo(badge_no: string): string {
  const clean = badge_no.replace(/\s/g, "");
  const n = parseInt(clean, 16);
  if (isNaN(n)) throw new Error(`Invalid badge_no: ${badge_no}`);
  return String(n);
}

/**
 * Derive a stable numeric employeeNo for Hikvision (max 9 digits).
 * Prefers worker.employee_number if it is purely numeric, otherwise
 * derives a 7-digit number from the worker UUID.
 */
export function hikEmployeeNo(w: { employee_number: string | null; id: string }): string {
  if (w.employee_number && /^\d{1,9}$/.test(w.employee_number)) {
    return w.employee_number;
  }
  // Stable 7-digit fallback from UUID
  const hex = w.id.replace(/-/g, "").slice(0, 8);
  return String((parseInt(hex, 16) % 9_000_000) + 1_000_000);
}

function hikTime(hhmm: string): string {
  return `${hhmm}:00`;   // "HH:MM" → "HH:MM:SS"
}

function parseHikError(text: string): string | undefined {
  try {
    const j = JSON.parse(text);
    return j.statusString ?? j.subStatusCode ?? j.errorMsg;
  } catch {
    return text.match(/<statusString>([^<]+)<\/statusString>/i)?.[1];
  }
}

// ─── Digest auth (identical pattern to HikvisionIntercomService) ─────────────

interface DigestChallenge {
  realm: string; nonce: string; qop?: string; algorithm?: string; opaque?: string;
}

function parseDigestChallenge(wwwAuth: string): DigestChallenge {
  const g = (key: string) =>
    wwwAuth.match(new RegExp(`${key}="([^"]+)"`, "i"))?.[1] ??
    wwwAuth.match(new RegExp(`${key}=([^,\\s]+)`, "i"))?.[1];
  return { realm: g("realm") ?? "", nonce: g("nonce") ?? "", qop: g("qop"), algorithm: g("algorithm"), opaque: g("opaque") };
}

function pickQop(qopHeader: string | undefined): "auth" | "auth-int" | undefined {
  if (!qopHeader) return undefined;
  const list = qopHeader.split(",").map((s) => s.trim().toLowerCase());
  return list.includes("auth") ? "auth" : list.includes("auth-int") ? "auth-int" : undefined;
}

function buildDigestHeader(method: string, uri: string, ch: DigestChallenge, user: string, pass: string, body: string): string {
  const algo = (ch.algorithm ?? "MD5").replace(/-sess$/i, "").toLowerCase();
  const hash = (s: string) => crypto.createHash(algo).update(s).digest("hex");
  const qop = pickQop(ch.qop);
  const ha1 = hash(`${user}:${ch.realm}:${pass}`);
  const ha2 = qop === "auth-int" ? hash(`${method}:${uri}:${hash(body)}`) : hash(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const response = qop ? hash(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(`${ha1}:${ch.nonce}:${ha2}`);
  const parts = [`Digest username="${user}"`, `realm="${ch.realm}"`, `nonce="${ch.nonce}"`, `uri="${uri}"`, `response="${response}"`];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (ch.opaque) parts.push(`opaque="${ch.opaque}"`);
  if (ch.algorithm) parts.push(`algorithm=${ch.algorithm}`);
  return parts.join(", ");
}

// ─── HikvisionACSService ──────────────────────────────────────────────────────

export class HikvisionACSService {
  private readonly baseUrl: string;

  constructor(private readonly cfg: ACSConfig) {
    this.baseUrl = `http://${cfg.ip_address}:${cfg.http_port}`;
  }

  // ── Internal HTTP helper ────────────────────────────────────────────────────

  private async request(method: string, path: string, body?: unknown, ct?: string): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}${path}`;
    const { username, password } = this.cfg;
    const bodyStr = body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const contentType = ct ?? (bodyStr != null ? "application/json" : undefined);
    const bodyBytes = bodyStr != null ? new TextEncoder().encode(bodyStr) : undefined;

    // Phase 1: probe for digest challenge
    let challenge: DigestChallenge | undefined;
    try {
      const probe = await fetch(`${this.baseUrl}/ISAPI/System/deviceInfo`, {
        method: "GET", headers: { Accept: "*/*" }, signal: AbortSignal.timeout(8_000),
      });
      try { await probe.arrayBuffer(); } catch { /* drain */ }
      const wwwAuth = probe.headers.get("www-authenticate") ?? "";
      if (probe.status === 401 && wwwAuth.toLowerCase().includes("digest")) {
        challenge = parseDigestChallenge(wwwAuth);
      }
    } catch (e) {
      console.warn("[acs] probe failed:", e instanceof Error ? e.message : e);
    }

    // Phase 2: real request
    const authHeader = challenge
      ? buildDigestHeader(method, path, challenge, username, password, bodyStr ?? "")
      : "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const hdrs: Record<string, string> = { Accept: "*/*", Authorization: authHeader };
    if (contentType) hdrs["Content-Type"] = contentType;

    let res = await fetch(url, {
      method, headers: hdrs,
      signal: AbortSignal.timeout(10_000),
      ...(bodyBytes != null ? { body: bodyBytes } : {}),
    });

    // Phase 3: one retry on 401
    if (res.status === 401) {
      const wwwAuth = res.headers.get("www-authenticate") ?? "";
      try { await res.arrayBuffer(); } catch { /* drain */ }
      if (wwwAuth.toLowerCase().includes("digest")) {
        const fresh = parseDigestChallenge(wwwAuth);
        const dh = buildDigestHeader(method, path, fresh, username, password, bodyStr ?? "");
        res = await fetch(url, { method, headers: { ...hdrs, Authorization: dh }, signal: AbortSignal.timeout(10_000), ...(bodyBytes != null ? { body: bodyBytes } : {}) });
      }
    }

    const text = await res.text().catch(() => "");
    console.log(`[acs:${this.cfg.name}] ${method} ${path} → ${res.status}`);
    return { ok: res.ok, status: res.status, text };
  }

  // ── Connectivity ────────────────────────────────────────────────────────────

  async testConnectivity(): Promise<HikResult & { device_name?: string }> {
    try {
      const r = await this.request("GET", "/ISAPI/System/deviceInfo");
      if (r.status >= 500) return { success: false, raw_status: r.status, error: `Fault: HTTP ${r.status}` };
      if (!r.ok) return { success: true, raw_status: r.status };
      try {
        const j = JSON.parse(r.text);
        return { success: true, device_name: j.DeviceInfo?.deviceName ?? j.deviceName };
      } catch {
        const m = r.text.match(/<deviceName>([^<]+)<\/deviceName>/i);
        return { success: true, device_name: m?.[1] };
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Time templates ──────────────────────────────────────────────────────────

  /**
   * Push a time template to the device.
   * Template 1 is always "24/7" on all Hikvision devices — do NOT overwrite it.
   */
  async syncTimeTemplate(shift: ShiftTemplate): Promise<HikResult> {
    if (shift.hik_template_no <= 1) return { success: false, error: "Template slot 1 is reserved — use slot ≥ 2" };

    const weekPlanCfgList = HIK_DAY_NAMES.map((dayName, jsDay) => ({
      weekDay: dayName,
      enable: shift.days_of_week.includes(jsDay),
      TimeSegment: shift.days_of_week.includes(jsDay)
        ? [{ startTime: hikTime(shift.start_time), endTime: hikTime(shift.end_time) }]
        : [],
    }));

    const body = {
      TimeTemplateList: {
        TimeTemplate: [{
          id: shift.hik_template_no,
          name: shift.name.slice(0, 32),
          enable: true,
          weekPlanTemplate: { WeekPlanCfgList: weekPlanCfgList },
        }],
      },
    };

    try {
      const r = await this.request("PUT", "/ISAPI/AccessControl/timeTemplates?format=json", body);
      if (!r.ok) return { success: false, raw_status: r.status, error: parseHikError(r.text) ?? `HTTP ${r.status}`, upstream_body: r.text };
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Card users ──────────────────────────────────────────────────────────────

  /**
   * Create or update a card user on the device.
   * Uses upsert via SetUp (Hikvision ignores duplicate if same employeeNo).
   * templateNo 1 = always (24/7), 2..N = specific shift schedule.
   */
  async syncCardUser(params: CardUserParams): Promise<HikResult> {
    const forever = { enable: true, beginTime: "2026-01-01T00:00:00", endTime: "2099-12-31T23:59:59", timeType: "local" };

    const body = {
      UserInfo: {
        employeeNo: params.employeeNo,
        name: params.name.slice(0, 32),
        userType: "normal",
        Valid: forever,
        doorRight: "1",
        RightPlan: [{ doorNo: params.doorNo, planTemplateNo: String(params.templateNo) }],
        CardInfo: [{ cardNo: params.cardNo, cardType: "normalCard" }],
      },
    };

    try {
      const r = await this.request("PUT", "/ISAPI/AccessControl/UserInfo/SetUp?format=json", body);
      if (!r.ok) {
        const errMsg = parseHikError(r.text) ?? `HTTP ${r.status}`;
        // On some firmwares CardInfo is not accepted inline — try separate endpoint
        if (r.status === 400 || (r.text && r.text.toLowerCase().includes("card"))) {
          return await this.syncCardUserSeparate(params);
        }
        return { success: false, raw_status: r.status, error: errMsg, upstream_body: r.text };
      }
      // Check embedded statusCode
      try {
        const j = JSON.parse(r.text);
        if (j.statusCode != null && j.statusCode !== 1) {
          const msg = j.statusString ?? j.subStatusCode ?? `statusCode=${j.statusCode}`;
          // If error is about CardInfo, retry without it, then add card separately
          if (msg.toLowerCase().includes("card")) return await this.syncCardUserSeparate(params);
          return { success: false, raw_status: r.status, error: msg };
        }
      } catch { /* non-JSON OK */ }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Fallback: create user without card, then attach card via CardInfo/SetUp. */
  private async syncCardUserSeparate(params: CardUserParams): Promise<HikResult> {
    const forever = { enable: true, beginTime: "2026-01-01T00:00:00", endTime: "2099-12-31T23:59:59", timeType: "local" };

    // Step 1: create user without card
    const userBody = {
      UserInfo: {
        employeeNo: params.employeeNo,
        name: params.name.slice(0, 32),
        userType: "normal",
        Valid: forever,
        doorRight: "1",
        RightPlan: [{ doorNo: params.doorNo, planTemplateNo: String(params.templateNo) }],
      },
    };
    try {
      const r1 = await this.request("PUT", "/ISAPI/AccessControl/UserInfo/SetUp?format=json", userBody);
      if (!r1.ok) return { success: false, raw_status: r1.status, error: parseHikError(r1.text) ?? `HTTP ${r1.status}`, upstream_body: r1.text };

      // Step 2: attach card
      const cardBody = {
        CardInfo: {
          employeeNo: params.employeeNo,
          cardNo: params.cardNo,
          cardType: "normalCard",
        },
      };
      const r2 = await this.request("PUT", "/ISAPI/AccessControl/CardInfo/SetUp?format=json", cardBody);
      if (!r2.ok) return { success: false, raw_status: r2.status, error: `Card attach: ${parseHikError(r2.text) ?? `HTTP ${r2.status}`}`, upstream_body: r2.text };
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Delete a card user from the device. */
  async deleteCardUser(employeeNo: string): Promise<HikResult> {
    try {
      const body = { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } };
      const r = await this.request("PUT", "/ISAPI/AccessControl/UserInfo/Delete?format=json", body);
      if (r.status === 404 || r.text.includes("no matched")) return { success: true };
      if (!r.ok) return { success: false, raw_status: r.status, error: parseHikError(r.text) ?? `HTTP ${r.status}` };
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** List all users currently on the device. */
  async listCardUsers(): Promise<{ success: boolean; users: { employeeNo: string; name: string }[]; error?: string }> {
    try {
      const body = { UserInfoSearchCond: { searchID: "1", searchResultPosition: 0, maxResults: 1000 } };
      const r = await this.request("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", body);
      if (!r.ok) return { success: false, users: [], error: parseHikError(r.text) ?? `HTTP ${r.status}` };
      try {
        const j = JSON.parse(r.text);
        const list = j.UserInfoSearch?.UserInfo ?? [];
        return { success: true, users: list.map((u: any) => ({ employeeNo: u.employeeNo, name: u.name })) };
      } catch {
        return { success: false, users: [], error: "Failed to parse response" };
      }
    } catch (e) {
      return { success: false, users: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Anti-passback ────────────────────────────────────────────────────────────

  /**
   * Configure anti-passback on the device.
   * ASC3202B: one-card-in / one-card-out enforcement per door.
   * mode: "double" = both readers enforce passback (recommended)
   *       "single" = only entry reader
   *       "none"   = disable
   */
  async setAntiPassback(doorNo: number, enable: boolean, mode: "double" | "single" | "none" = "double"): Promise<HikResult> {
    const body = {
      AntiPassback: {
        enable,
        doorIndex: doorNo,
        antiPassbackType: enable ? mode : "none",
      },
    };

    try {
      const r = await this.request("PUT", "/ISAPI/AccessControl/antiPassback?format=json", body);
      if (!r.ok) {
        // Try alternate endpoint path used by some firmware versions
        const r2 = await this.request("PUT", "/ISAPI/AccessControl/antiPassback/config?format=json", {
          AntiPassbackCfg: {
            doorAntiPassbackList: [{ doorNo, enable, antiPassbackType: enable ? mode : "none" }],
          },
        });
        if (!r2.ok) return { success: false, raw_status: r2.status, error: parseHikError(r2.text) ?? `HTTP ${r2.status}`, upstream_body: r2.text };
        return { success: true };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Full sync ────────────────────────────────────────────────────────────────

  /**
   * Push all active workers for this device's entrance.
   * @param workers  workers with active access to this entrance
   * @param shifts   all shifts that appear in the worker rules (for time templates)
   */
  async fullSync(workers: SyncWorkerInput[], shifts: ShiftTemplate[]): Promise<FullSyncResult> {
    const result: FullSyncResult = {
      device: this.cfg.name,
      total: workers.length,
      synced: 0,
      skipped: 0,
      failed: [],
      template_errors: [],
    };

    // ── 1. Sync time templates for every shift used ──────────────────────────
    const usedShiftIds = new Set(workers.map((w) => w.shift_id).filter(Boolean));
    const usedShifts = shifts.filter((s) => usedShiftIds.has((s as any).id));

    for (const shift of usedShifts) {
      if (!shift.hik_template_no) continue;
      const r = await this.syncTimeTemplate(shift);
      if (!r.success) result.template_errors.push(`Template "${shift.name}": ${r.error}`);
    }

    // Build shift_id → template_no map
    const shiftTemplateMap = new Map<string, number>(
      (shifts as any[]).map((s) => [s.id, s.hik_template_no ?? 1])
    );

    // ── 2. Sync card users ───────────────────────────────────────────────────
    for (const w of workers) {
      if (!w.badge_no) {
        result.skipped++;
        continue;
      }

      let cardNo: string;
      try {
        cardNo = hikCardNo(w.badge_no);
      } catch {
        result.failed.push({ employeeNo: hikEmployeeNo(w), name: `${w.last_name} ${w.first_name}`, error: `Invalid badge_no: ${w.badge_no}` });
        continue;
      }

      const templateNo = w.shift_id ? (shiftTemplateMap.get(w.shift_id) ?? 1) : 1;

      const r = await this.syncCardUser({
        employeeNo: hikEmployeeNo(w),
        name: `${w.last_name} ${w.first_name}`.slice(0, 32),
        cardNo,
        doorNo: this.cfg.relay_no,
        templateNo,
      });

      if (r.success) {
        result.synced++;
      } else {
        result.failed.push({ employeeNo: hikEmployeeNo(w), name: `${w.last_name} ${w.first_name}`, error: r.error ?? "unknown" });
      }
    }

    return result;
  }
}
