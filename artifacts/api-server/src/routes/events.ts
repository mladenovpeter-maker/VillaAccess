/**
 * Events API
 *
 * GET  /events         — paginated domain event history (REST)
 * GET  /events/stats   — event counts by category for the last 24h
 * GET  /events/stream  — SSE real-time stream (token via ?token= query param)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { domainEventsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { eventBus } from "../lib/events";
import { requireAuth } from "./auth";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "villa_jwt_secret_dev_only";

// ─── GET /events ──────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const {
    category,
    event_type,
    severity,
    vehicle_id,
    villa_id,
    camera_id,
    source,
    since,
    until,
    page = "1",
    page_size = "50",
  } = req.query as Record<string, string>;

  const pageNum     = Math.max(1, parseInt(page) || 1);
  const pageSizeNum = Math.min(200, parseInt(page_size) || 50);

  const conditions: any[] = [];
  if (category)   conditions.push(eq(domainEventsTable.category, category));
  if (event_type) conditions.push(eq(domainEventsTable.event_type, event_type));
  if (severity)   conditions.push(eq(domainEventsTable.severity, severity));
  if (vehicle_id) conditions.push(eq(domainEventsTable.vehicle_id, vehicle_id));
  if (villa_id)   conditions.push(eq(domainEventsTable.villa_id, villa_id));
  if (camera_id)  conditions.push(eq(domainEventsTable.camera_id, camera_id));
  if (source)     conditions.push(eq(domainEventsTable.source, source));
  if (since)      conditions.push(gte(domainEventsTable.created_at, new Date(since)));
  if (until)      conditions.push(lte(domainEventsTable.created_at, new Date(until)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(domainEventsTable)
      .where(where),
    db
      .select()
      .from(domainEventsTable)
      .where(where)
      .orderBy(desc(domainEventsTable.created_at))
      .limit(pageSizeNum)
      .offset((pageNum - 1) * pageSizeNum),
  ]);

  res.json({
    items: rows.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      category: e.category,
      severity: e.severity,
      payload: e.payload,
      vehicle_id: e.vehicle_id,
      villa_id: e.villa_id,
      camera_id: e.camera_id,
      reservation_id: e.reservation_id,
      operator_id: e.operator_id,
      source: e.source,
      created_at: e.created_at,
    })),
    total: countResult[0]?.count ?? 0,
    page: pageNum,
    page_size: pageSizeNum,
  });
});

// ─── GET /events/stats ────────────────────────────────────────────────────────

router.get("/stats", requireAuth, async (_req, res) => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byCategory, bySeverity, recentCount] = await Promise.all([
    db
      .select({
        category: domainEventsTable.category,
        count: sql<number>`count(*)::int`,
      })
      .from(domainEventsTable)
      .where(gte(domainEventsTable.created_at, since24h))
      .groupBy(domainEventsTable.category),

    db
      .select({
        severity: domainEventsTable.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(domainEventsTable)
      .where(gte(domainEventsTable.created_at, since24h))
      .groupBy(domainEventsTable.severity),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(domainEventsTable)
      .where(gte(domainEventsTable.created_at, since24h)),
  ]);

  res.json({
    period: "24h",
    total: recentCount[0]?.count ?? 0,
    by_category: Object.fromEntries(byCategory.map((r) => [r.category, r.count])),
    by_severity: Object.fromEntries(bySeverity.map((r) => [r.severity, r.count])),
    sse_clients: eventBus.clientCount,
  });
});

// ─── GET /events/stream ───────────────────────────────────────────────────────
// SSE endpoint. Auth via ?token= query param (EventSource API doesn't support headers).

router.get("/stream", async (req, res) => {
  // Verify JWT from query param
  const token =
    (req.query.token as string) ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    res.status(401).json({ detail: "Token required" });
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ detail: "Invalid or expired token" });
    return;
  }

  // ── SSE handshake ─────────────────────────────────────────────────────────
  res.setHeader("Content-Type",   "text/event-stream");
  res.setHeader("Cache-Control",  "no-cache, no-transform");
  res.setHeader("Connection",     "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx proxy buffering
  res.flushHeaders();

  // Connected message
  res.write(`data: ${JSON.stringify({ type: "connected", clients: eventBus.clientCount + 1 })}\n\n`);

  // Register this response as a live client
  const clientId = crypto.randomUUID();
  const removeClient = eventBus.addSSEClient(res, clientId);

  // Keep-alive ping every 25 seconds (prevents proxy / browser timeout)
  const pingInterval = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      clearInterval(pingInterval);
      removeClient();
    }
  }, 25_000);

  // Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(pingInterval);
    removeClient();
  });
});

export { router as eventsRouter };
