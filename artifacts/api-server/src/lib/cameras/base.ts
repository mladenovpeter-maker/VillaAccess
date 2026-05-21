import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import type { CameraAdapter, CameraConfig } from "./types";
import { uploadsUrl } from "../public-url";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

// ─── HTTP Digest Auth ──────────────────────────────────────────────────────────

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
    qop: g("qop"),
    algorithm: g("algorithm"),
    opaque: g("opaque"),
  };
}

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

// ─── BaseCameraAdapter ─────────────────────────────────────────────────────────

export abstract class BaseCameraAdapter implements CameraAdapter {
  protected readonly config: CameraConfig;

  constructor(config: CameraConfig) {
    this.config = config;
  }

  get baseUrl(): string {
    return `http://${this.config.ip_address}:${this.config.http_port}`;
  }

  /**
   * Authenticated HTTP request to the camera.
   *
   * Strategy:
   *  1. First attempt with Basic auth (fast, works on some firmware)
   *  2. If the camera returns 401 with WWW-Authenticate: Digest, automatically
   *     retries with the correct Digest response (RFC 7616 MD5/SHA-256).
   */
  protected async fetchCamera(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const { username, password } = this.config;
    const timeoutMs = 10_000;

    const baseHeaders: Record<string, string> = {
      Accept: "*/*",
      ...(contentType ? { "Content-Type": contentType } : {}),
    };

    const init: RequestInit = {
      method,
      headers: {
        ...baseHeaders,
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
      signal: AbortSignal.timeout(timeoutMs),
      ...(body != null ? { body } : {}),
    };

    let res = await fetch(url, init);
    console.log("[fetchCamera] basic", { method, path, status: res.status });

    // Attempt Digest auth if Basic was rejected
    if (
      res.status === 401 &&
      res.headers.get("www-authenticate")?.toLowerCase().includes("digest")
    ) {
      const wwwAuth = res.headers.get("www-authenticate") ?? "";
      // Drain the 401 body so the underlying socket is released cleanly
      try { await res.arrayBuffer(); } catch { /* ignore */ }

      const challenge = parseDigestChallenge(wwwAuth);
      const digestHeader = buildDigestHeader(
        method, path, challenge, username, password, body ?? "",
      );
      console.log("[fetchCamera] digest retry", {
        method, path,
        realm: challenge.realm,
        qop: challenge.qop,
        algorithm: challenge.algorithm,
      });

      res = await fetch(url, {
        method,
        headers: { ...baseHeaders, Authorization: digestHeader },
        signal: AbortSignal.timeout(timeoutMs),
        ...(body != null ? { body } : {}),
      });
      console.log("[fetchCamera] digest", { method, path, status: res.status });
    }

    return res;
  }

  /**
   * Save a raw image buffer to the local uploads directory.
   * Returns the browser-accessible URL: /api/uploads/snapshots/...
   */
  protected async saveImageBuffer(
    buffer: Buffer,
    ext: string,
  ): Promise<{ url: string; size: number }> {
    const now = new Date();
    const dir = path.join(
      UPLOADS_ROOT,
      "snapshots",
      now.getFullYear().toString(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await fs.mkdir(dir, { recursive: true });

    const filename = `cam-${this.config.id.slice(0, 8)}-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buffer);

    const rel = path.relative(UPLOADS_ROOT, filePath).replace(/\\/g, "/");
    return { url: uploadsUrl(rel), size: buffer.byteLength };
  }

  // ── Abstract methods each adapter must implement ────────────────────────────

  abstract get_snapshot(): ReturnType<CameraAdapter["get_snapshot"]>;
  abstract open_gate(): ReturnType<CameraAdapter["open_gate"]>;
  abstract get_status(): ReturnType<CameraAdapter["get_status"]>;
}
