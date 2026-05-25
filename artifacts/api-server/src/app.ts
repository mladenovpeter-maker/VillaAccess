import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind nginx — trust the first proxy hop so req.ip reflects real client IP
// (needed for rate limiting and accurate access logs).
app.set("trust proxy", 1);

// Loud warning if JWT_SECRET is missing in production. We keep the dev
// fallback so non-prod environments still work, but production deploys
// MUST set JWT_SECRET in .env.docker.
if (process.env["NODE_ENV"] === "production" && !process.env["JWT_SECRET"]) {
  logger.error(
    "JWT_SECRET is not set in production — using insecure fallback. " +
    "Set JWT_SECRET in .env.docker IMMEDIATELY (random 32+ chars).",
  );
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers. CSP and COEP are disabled because they break the SPA
// dev workflow (Vite HMR) and the snapshot <img> tags loaded cross-origin
// during development. Other helmet defaults are safe: X-Frame-Options=DENY,
// X-Content-Type-Options=nosniff, Referrer-Policy, etc.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// CORS — env-driven allowlist (comma-separated origins in CORS_ALLOWED_ORIGINS).
// If unset, falls back to permissive cors() (preserves existing dev workflow).
// In production set e.g. CORS_ALLOWED_ORIGINS="https://villas.example.com".
const corsOrigins = process.env["CORS_ALLOWED_ORIGINS"]
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors(
    corsOrigins && corsOrigins.length > 0
      ? { origin: corsOrigins, credentials: true }
      : undefined,
  ),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded snapshots at /api/uploads/* (proxied from dashboard via Vite)
app.use(
  "/api/uploads",
  express.static(path.resolve(process.cwd(), "uploads"), {
    maxAge: "1d",
    etag: true,
  }),
);

app.use("/api", router);

export default app;
