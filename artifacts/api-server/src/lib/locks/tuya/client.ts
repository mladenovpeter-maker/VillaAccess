/**
 * Tuya OpenAPI HTTP client with HMAC-SHA256 request signing + token cache.
 *
 * Reference: https://developer.tuya.com/en/docs/iot/api-overview-development
 *
 * Auth flow:
 *   1. GET  /v1.0/token?grant_type=1                  → { access_token, expire_time }
 *   2. Use access_token in every business call. Token TTL is ~2h; we
 *      refresh ~5 min early and on 1010/1011/1012 error codes.
 *
 * Signing algorithm (v2.0):
 *
 *   For TOKEN requests (no access_token yet):
 *     signStr = client_id + t + [nonce] + stringToSign
 *     sign    = HMAC-SHA256(signStr, secret).toUpperCase()
 *
 *   For BUSINESS requests (after we have a token):
 *     signStr = client_id + access_token + t + [nonce] + stringToSign
 *     sign    = HMAC-SHA256(signStr, secret).toUpperCase()
 *
 *   stringToSign = HTTPMethod + "\n"
 *                + sha256(body).toLowerCase() + "\n"
 *                + headers  + "\n"        (we always send empty here)
 *                + pathAndQuery           (canonicalised path + sorted query)
 *
 * Headers required on every request:
 *   client_id, sign, t, sign_method=HMAC-SHA256, [nonce], access_token (business)
 *
 * The client is a module-level singleton lazily configured from
 * TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_REGION env vars. Throws a
 * descriptive error if creds are missing — the lock routes catch this
 * and surface it as a 503 with a clear message.
 */

import * as crypto from "crypto";

const TUYA_REGION_HOSTS: Record<string, string> = {
  eu:         "https://openapi.tuyaeu.com",
  "eu-west":  "https://openapi-weaz.tuyaeu.com",
  us:         "https://openapi.tuyaus.com",
  "us-west":  "https://openapi-ueaz.tuyaus.com",
  in:         "https://openapi.tuyain.com",
  cn:         "https://openapi.tuyacn.com",
};

const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_LEEWAY_MS = 5 * 60 * 1000; // refresh 5 min early
const RETRYABLE_AUTH_CODES = new Set([1010, 1011, 1012]); // token expired / invalid

interface TuyaConfig {
  accessId: string;
  accessSecret: string;
  host: string;
}

interface TokenState {
  access_token: string;
  expires_at: number; // epoch ms
}

export class TuyaApiError extends Error {
  constructor(
    public code: number,
    public msg: string,
    public httpStatus: number,
    public path: string,
  ) {
    super(`Tuya API error ${code} on ${path}: ${msg} (HTTP ${httpStatus})`);
    this.name = "TuyaApiError";
  }
}

export class TuyaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuyaConfigError";
  }
}

// ── Module-level singleton state ─────────────────────────────────────────────

let _config: TuyaConfig | null = null;
let _token: TokenState | null = null;
let _tokenInFlight: Promise<string> | null = null;

function readConfig(): TuyaConfig {
  if (_config) return _config;
  const accessId = process.env.TUYA_ACCESS_ID;
  const accessSecret = process.env.TUYA_ACCESS_SECRET;
  const region = (process.env.TUYA_REGION ?? "eu").toLowerCase();
  if (!accessId || !accessSecret) {
    throw new TuyaConfigError(
      "Tuya disabled: TUYA_ACCESS_ID and TUYA_ACCESS_SECRET must be set in env.",
    );
  }
  const host = TUYA_REGION_HOSTS[region];
  if (!host) {
    throw new TuyaConfigError(
      `Unknown TUYA_REGION="${region}". Allowed: ${Object.keys(TUYA_REGION_HOSTS).join(", ")}`,
    );
  }
  _config = { accessId, accessSecret, host };
  return _config;
}

/** Reset cached config + token. Useful in tests; called automatically on auth errors. */
export function resetTuyaClient(): void {
  _config = null;
  _token = null;
  _tokenInFlight = null;
}

export function isTuyaConfigured(): boolean {
  return !!(process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET);
}

export function tuyaRegion(): string {
  return (process.env.TUYA_REGION ?? "eu").toLowerCase();
}

// ── Signing primitives ───────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function hmacSha256Hex(message: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex")
    .toUpperCase();
}

/**
 * Build the canonical "stringToSign" portion.
 *
 * @param method  HTTP verb
 * @param body    Request body (may be empty for GET)
 * @param path    Path **with** query string, already canonical (query
 *                params alphabetically sorted before being joined).
 */
function buildStringToSign(method: string, body: string, path: string): string {
  const contentHash = sha256Hex(body);
  const headers = ""; // we don't sign extra headers
  return [method.toUpperCase(), contentHash, headers, path].join("\n");
}

function canonicalisePath(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return path;
  const entries = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return path;
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
}

// ── Token management ─────────────────────────────────────────────────────────

async function fetchNewToken(cfg: TuyaConfig): Promise<TokenState> {
  const path = "/v1.0/token?grant_type=1";
  const t = Date.now().toString();
  const stringToSign = buildStringToSign("GET", "", path);
  const signStr = cfg.accessId + t + stringToSign;
  const sign = hmacSha256Hex(signStr, cfg.accessSecret);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.host}${path}`, {
      method: "GET",
      headers: {
        client_id: cfg.accessId,
        sign,
        t,
        sign_method: "HMAC-SHA256",
      },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const json = (await resp.json()) as {
    success?: boolean;
    code?: number;
    msg?: string;
    result?: { access_token: string; expire_time: number };
  };
  if (!json.success || !json.result) {
    throw new TuyaApiError(json.code ?? -1, json.msg ?? "no result", resp.status, path);
  }
  return {
    access_token: json.result.access_token,
    expires_at: Date.now() + json.result.expire_time * 1000,
  };
}

async function getAccessToken(cfg: TuyaConfig): Promise<string> {
  if (_token && _token.expires_at - Date.now() > TOKEN_REFRESH_LEEWAY_MS) {
    return _token.access_token;
  }
  if (_tokenInFlight) return _tokenInFlight;
  _tokenInFlight = (async () => {
    try {
      _token = await fetchNewToken(cfg);
      return _token.access_token;
    } finally {
      _tokenInFlight = null;
    }
  })();
  return _tokenInFlight;
}

// ── Business request ────────────────────────────────────────────────────────

export interface TuyaRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string; // starts with /v1.0/ ...
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown; // JSON-serialisable
}

/**
 * Make a signed business request against the Tuya OpenAPI.
 *
 * Returns the unwrapped `result` field on success. Throws TuyaApiError on
 * any non-success response. Automatically refreshes the access token once
 * on 1010/1011/1012 (token-expired-ish) error codes before re-throwing.
 */
export async function tuyaRequest<T = unknown>(opts: TuyaRequestOptions): Promise<T> {
  const cfg = readConfig();
  return doRequest<T>(cfg, opts, /*retried*/ false);
}

async function doRequest<T>(
  cfg: TuyaConfig,
  opts: TuyaRequestOptions,
  retried: boolean,
): Promise<T> {
  const token = await getAccessToken(cfg);
  const path = canonicalisePath(opts.path, opts.query);
  const body = opts.body == null ? "" : JSON.stringify(opts.body);
  const t = Date.now().toString();
  const stringToSign = buildStringToSign(opts.method, body, path);
  const signStr = cfg.accessId + token + t + stringToSign;
  const sign = hmacSha256Hex(signStr, cfg.accessSecret);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.host}${path}`, {
      method: opts.method,
      headers: {
        client_id: cfg.accessId,
        sign,
        t,
        sign_method: "HMAC-SHA256",
        access_token: token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body || undefined,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const json = (await resp.json()) as {
    success?: boolean;
    code?: number;
    msg?: string;
    result?: T;
  };

  if (json.success) {
    return (json.result ?? (true as unknown as T));
  }

  // Token-expired class — refresh once and retry.
  if (!retried && json.code != null && RETRYABLE_AUTH_CODES.has(json.code)) {
    _token = null;
    return doRequest<T>(cfg, opts, /*retried*/ true);
  }

  throw new TuyaApiError(json.code ?? -1, json.msg ?? "unknown", resp.status, path);
}
