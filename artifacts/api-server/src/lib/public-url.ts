/**
 * Build a browser-facing URL for files served from /api/uploads.
 *
 * In production, frontend nginx may not proxy binary responses on
 * /api/uploads/* correctly. Set PUBLIC_UPLOADS_URL (or PUBLIC_API_URL)
 * to a fully-qualified origin like "http://172.16.32.105:8080" and the
 * server will return absolute URLs that bypass the dashboard proxy.
 *
 * In dev / Replit, leave both unset and clients receive root-relative
 * URLs like "/api/uploads/snapshots/..." which Vite proxies to :8080.
 */
function getOrigin(): string {
  const raw =
    process.env.PUBLIC_UPLOADS_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim() ||
    "";
  return raw.replace(/\/+$/, "");
}

export function uploadsUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  const origin = getOrigin();
  return origin ? `${origin}/api/uploads/${clean}` : `/api/uploads/${clean}`;
}
