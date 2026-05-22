/**
 * Hikvision Intercom PIN Service
 *
 * Uses Hikvision ISAPI to manage guest PIN codes on door stations.
 *
 * ISAPI endpoints used:
 *   GET  /ISAPI/System/deviceInfo                         → connectivity test
 *   PUT  /ISAPI/AccessControl/UserInfo/SetUp?format=JSON  → create / update PIN user
 *   PUT  /ISAPI/AccessControl/UserInfo/Delete?format=JSON → revoke / delete PIN user
 *
 * Authentication: Basic auth (fast path) → Digest MD5 fallback (RFC 7616)
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntercomConfig {
  id: string;
  name: string;
  ip_address: string;
  http_port: number;
  username: string;
  password: string;
  relay_no: number;
}

export interface PinPayload {
  /** Short stable ID used as the Hikvision employeeNo (≤32 chars). */
  employeeNo: string;
  guestName: string;
  pin: string;
  validFrom: Date;
  validTo: Date;
}

export interface HikResult {
  success: boolean;
  error?: string;
  raw_status?: number;
}

// ─── Digest Auth helpers — identical to lib/cameras/base.ts ──────────────────
// DO NOT simplify. Hikvision ACS terminals require full RFC 7616 digest auth
// with proper qop list parsing and auth-int body hashing.

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  algorithm?: string;
  opaque?: string;
}

function parseDigestChallenge(wwwAuth: string): DigestChallenge {
  const g = (key: string) =>
    wwwAuth.match(new RegExp(`${key}="([^"]+)"`))?.[1] ??
    wwwAuth.match(new RegExp(`${key}=([^,\\s]+)`))?.[1];
  return {
    realm: g("realm") ?? "",
    nonce: g("nonce") ?? "",
    qop:       g("qop"),
    algorithm: g("algorithm"),
    opaque:    g("opaque"),
  };
}

/**
 * Pick the best qop from the WWW-Authenticate header value.
 * The header may list multiple options, e.g. qop="auth,auth-int".
 * Prefer "auth" over "auth-int" (simpler, no body hashing needed).
 */
function pickQop(qopHeader: string | undefined): "auth" | "auth-int" | undefined {
  if (!qopHeader) return undefined;
  const list = qopHeader.split(",").map((s) => s.trim().toLowerCase());
  if (list.includes("auth")) return "auth";
  if (list.includes("auth-int")) return "auth-int";
  return undefined;
}

function buildDigestHeader(
  method: string,
  uri: string,
  challenge: DigestChallenge,
  username: string,
  password: string,
  body: string,
): string {
  const algorithm = (challenge.algorithm ?? "MD5").replace(/-sess$/i, "").toLowerCase();
  const hash = (s: string) =>
    crypto.createHash(algorithm).update(s).digest("hex");

  const qop = pickQop(challenge.qop);
  const ha1 = hash(`${username}:${challenge.realm}:${password}`);
  const ha2 =
    qop === "auth-int"
      ? hash(`${method}:${uri}:${hash(body)}`)
      : hash(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");

  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `Digest username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  return parts.join(", ");
}

// ─── HikvisionIntercomService ─────────────────────────────────────────────────

export class HikvisionIntercomService {
  private readonly baseUrl: string;
  private readonly config: IntercomConfig;

  constructor(config: IntercomConfig) {
    this.config = config;
    this.baseUrl = `http://${config.ip_address}:${config.http_port}`;
  }

  // ── Internal HTTP helper ───────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: string | unknown,
    contentType?: string,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}${path}`;
    const { username, password } = this.config;
    const bodyStr =
      body == null     ? undefined
      : typeof body === "string" ? body
      : JSON.stringify(body);
    const ct = contentType ?? (bodyStr != null ? "application/json" : undefined);
    const timeoutMs = 10_000;

    const baseHeaders: Record<string, string> = {
      Accept: "*/*",
      ...(ct ? { "Content-Type": ct } : {}),
    };

    // ── Attempt 1: Basic auth ─────────────────────────────────────────────────
    let res = await fetch(url, {
      method,
      headers: {
        ...baseHeaders,
        Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
      signal: AbortSignal.timeout(timeoutMs),
      ...(bodyStr != null ? { body: bodyStr } : {}),
    });
    console.log("[acs] basic", { method, path, status: res.status });

    // ── Attempt 2: Digest auth on 401 ─────────────────────────────────────────
    if (
      res.status === 401 &&
      res.headers.get("www-authenticate")?.toLowerCase().includes("digest")
    ) {
      const wwwAuth = res.headers.get("www-authenticate") ?? "";
      // Drain body so the underlying TCP socket is released cleanly
      try { await res.arrayBuffer(); } catch { /* ignore */ }

      const challenge = parseDigestChallenge(wwwAuth);
      const digestHeader = buildDigestHeader(
        method, path, challenge, username, password, bodyStr ?? "",
      );
      console.log("[acs] digest retry", {
        method, path,
        realm: challenge.realm,
        qop: challenge.qop,
        algorithm: challenge.algorithm,
      });

      res = await fetch(url, {
        method,
        headers: { ...baseHeaders, Authorization: digestHeader },
        signal: AbortSignal.timeout(timeoutMs),
        ...(bodyStr != null ? { body: bodyStr } : {}),
      });
      console.log("[acs] digest", { method, path, status: res.status });
    }

    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Test connectivity by fetching device info.
   * Returns device name/model on success.
   */
  async testConnectivity(): Promise<HikResult & { device_name?: string; serial?: string }> {
    try {
      const r = await this.request("GET", "/ISAPI/System/deviceInfo");
      if (!r.ok) return { success: false, raw_status: r.status, error: `HTTP ${r.status}` };
      // Parse minimal fields from JSON or XML response
      let device_name: string | undefined;
      let serial: string | undefined;
      try {
        const j = JSON.parse(r.text);
        device_name = j.DeviceInfo?.deviceName ?? j.deviceName;
        serial = j.DeviceInfo?.serialNumber ?? j.serialNumber;
      } catch {
        const xmlMatch = r.text.match(/<deviceName>([^<]+)<\/deviceName>/i);
        device_name = xmlMatch?.[1];
        const snMatch = r.text.match(/<serialNumber>([^<]+)<\/serialNumber>/i);
        serial = snMatch?.[1];
      }
      return { success: true, device_name, serial };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Pulse-safe door release.
   *
   * Sends:
   *   1) PUT /ISAPI/AccessControl/RemoteControl/door/{relay_no}  cmd:"open"
   *   2) wait PULSE_MS (3 000 ms)
   *   3) PUT same endpoint  cmd:"close"   ← ALWAYS in finally
   *
   * The ACS terminal also enforces its own door-open duration from device
   * config, but we add a server-side close command as a belt-and-suspenders
   * safety layer so the latch is NEVER left permanently open even if device
   * firmware behaviour is non-standard.
   */
  async openDoor(): Promise<HikResult & { elapsed_ms?: number }> {
    const PULSE_MS = 3_000;
    const doorPath = `/ISAPI/AccessControl/RemoteControl/door/${this.config.relay_no}`;
    const t0 = Date.now();

    // Hikvision ACS ISAPI RemoteControl/door requires XML with the Hikvision
    // namespace declaration. Without xmlns the device returns an error even
    // though the manual curl (which includes it) succeeds.
    const doorXml = (cmd: "open" | "close") =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">\n  <cmd>${cmd}</cmd>\n</RemoteControlDoor>`;

    let openError: string | undefined;
    let openStatus = 0;
    let closeError: string | undefined;

    try {
      // 1) Open command
      try {
        const body = doorXml("open");
        console.log(`[acs.openDoor] ▶ PUT ${this.baseUrl}${doorPath}`);
        console.log(`[acs.openDoor] body: ${body}`);
        const r = await this.request("PUT", doorPath, body, "application/xml");
        openStatus = r.status;
        console.log(`[acs.openDoor] open status=${r.status} body=${r.text.slice(0, 500)}`);
        if (!r.ok) openError = parseHikError(r.text) ?? `HTTP ${r.status}`;
      } catch (err) {
        console.error("[acs.openDoor] open threw:", err);
        openError = err instanceof Error ? err.message : String(err);
      }

      // Dwell — skip if open already failed
      if (!openError) {
        await new Promise((resolve) => setTimeout(resolve, PULSE_MS));
      }
    } finally {
      // 2) Close command — ALWAYS attempt
      try {
        const body = doorXml("close");
        console.log(`[acs.openDoor] ◀ PUT ${this.baseUrl}${doorPath} (close)`);
        const r = await this.request("PUT", doorPath, body, "application/xml");
        console.log(`[acs.openDoor] close status=${r.status} body=${r.text.slice(0, 200)}`);
        if (!r.ok) closeError = parseHikError(r.text) ?? `HTTP ${r.status}`;
      } catch (err) {
        console.error("[acs.openDoor] close threw:", err);
        closeError = err instanceof Error ? err.message : String(err);
      }
    }

    const success = !openError && !closeError;
    const errorParts = [openError, closeError].filter(Boolean);
    console.log(`[acs.openDoor] result: success=${success} elapsed=${Date.now() - t0}ms${success ? "" : ` error=${errorParts.join("; ")}`}`);
    return {
      success,
      raw_status: openStatus,
      elapsed_ms: Date.now() - t0,
      ...(success ? {} : { error: errorParts.join("; ") }),
    };
  }

  /**
   * Push a PIN user to the device.
   * Creates the user if it doesn't exist; updates it if it does.
   * Uses the reservation short-ID as employeeNo for idempotency.
   */
  async pushPin(payload: PinPayload): Promise<HikResult> {
    try {
      const body = {
        UserInfo: {
          employeeNo: payload.employeeNo,
          name: payload.guestName.slice(0, 32),
          userType: "normal",
          Valid: {
            enable: true,
            beginTime: formatHikDate(payload.validFrom),
            endTime:   formatHikDate(payload.validTo),
            timeType:  "local",
          },
          doorRight: "1",
          RightPlan: [{ doorNo: this.config.relay_no, planTemplateNo: "1" }],
          password: payload.pin,
        },
      };

      const r = await this.request("PUT", "/ISAPI/AccessControl/UserInfo/SetUp?format=JSON", body);

      if (!r.ok) {
        return { success: false, raw_status: r.status, error: parseHikError(r.text) ?? `HTTP ${r.status}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Revoke / delete the PIN user from the device.
   */
  async revokePin(employeeNo: string): Promise<HikResult> {
    try {
      const body = {
        UserInfoDelCond: {
          EmployeeNoList: [{ employeeNo }],
        },
      };

      const r = await this.request("PUT", "/ISAPI/AccessControl/UserInfo/Delete?format=JSON", body);

      // 404 or "no user found" is still a success for revocation purposes
      if (r.status === 404 || r.text.includes("no matched")) return { success: true };
      if (!r.ok) {
        return { success: false, raw_status: r.status, error: parseHikError(r.text) ?? `HTTP ${r.status}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Test PIN sync capability by pushing a dummy inactive user then immediately deleting it.
   */
  async testPinSync(): Promise<HikResult & { latency_ms?: number }> {
    const start = Date.now();
    const testNo = `TEST_${Date.now()}`;
    const push = await this.pushPin({
      employeeNo: testNo,
      guestName:  "SyncTest",
      pin:        "0000",
      validFrom:  new Date(Date.now() - 60_000),
      validTo:    new Date(Date.now() - 30_000), // already expired
    });
    if (!push.success) return { ...push, latency_ms: Date.now() - start };
    await this.revokePin(testNo);
    return { success: true, latency_ms: Date.now() - start };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a Date for Hikvision ISAPI: "YYYY-MM-DDTHH:mm:ss" (no Z — local time on device) */
function formatHikDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Try to extract a human-readable error message from a Hikvision error response. */
function parseHikError(text: string): string | undefined {
  try {
    const j = JSON.parse(text);
    return j.statusString ?? j.subStatusCode ?? j.errorMsg;
  } catch {
    const m = text.match(/<statusString>([^<]+)<\/statusString>/i);
    return m?.[1];
  }
}
