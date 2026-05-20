import { Router } from "express";
import { db } from "@workspace/db";
import {
  reservationsTable, vehiclesTable, logsTable, accessEventsTable,
  villasTable, entrancesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── GET /export/reservations ─────────────────────────────────────────────────

router.get("/reservations", requireAuth, async (req, res) => {
  const { format = "json", status, from, to } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (status) conditions.push(eq(reservationsTable.status, status as any));
  const fromDate = parseDate(from);
  const toDate   = parseDate(to);
  if (fromDate) conditions.push(gte(reservationsTable.check_in, fromDate));
  if (toDate)   conditions.push(lte(reservationsTable.check_out, toDate));

  const rows = await db
    .select({
      id: reservationsTable.id,
      guest_name: reservationsTable.guest_name,
      guest_phone: reservationsTable.guest_phone,
      guest_email: reservationsTable.guest_email,
      villa: villasTable.name,
      check_in: reservationsTable.check_in,
      check_out: reservationsTable.check_out,
      status: reservationsTable.status,
      pin_code: reservationsTable.pin_code,
      notes: reservationsTable.notes,
      created_at: reservationsTable.created_at,
    })
    .from(reservationsTable)
    .leftJoin(villasTable, eq(reservationsTable.villa_id, villasTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(reservationsTable.check_in);

  const data = rows.map((r) => ({
    ...r,
    check_in: r.check_in?.toISOString() ?? "",
    check_out: r.check_out?.toISOString() ?? "",
    created_at: r.created_at?.toISOString() ?? "",
  }));

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="reservations.csv"');
    res.send(toCSV(data));
  } else {
    res.setHeader("Content-Disposition", 'attachment; filename="reservations.json"');
    res.json({ count: data.length, exported_at: new Date().toISOString(), data });
  }
});

// ─── GET /export/vehicles ─────────────────────────────────────────────────────

router.get("/vehicles", requireAuth, async (req, res) => {
  const { format = "json", status } = req.query as Record<string, string>;

  const rows = await db
    .select({
      id: vehiclesTable.id,
      license_plate: vehiclesTable.license_plate,
      plate_region: vehiclesTable.plate_region,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      color: vehiclesTable.color,
      vehicle_type: vehiclesTable.vehicle_type,
      owner_name: vehiclesTable.owner_name,
      status: vehiclesTable.status,
      blacklist_reason: vehiclesTable.blacklist_reason,
      blacklisted_at: vehiclesTable.blacklisted_at,
      first_seen: vehiclesTable.first_seen,
      last_seen: vehiclesTable.last_seen,
      total_visits: vehiclesTable.total_visits,
      confidence_score: vehiclesTable.confidence_score,
      notes: vehiclesTable.notes,
      created_at: vehiclesTable.created_at,
    })
    .from(vehiclesTable)
    .where(status ? eq(vehiclesTable.status, status as any) : undefined)
    .orderBy(vehiclesTable.created_at);

  const data = rows.map((r) => ({
    ...r,
    blacklisted_at: r.blacklisted_at?.toISOString() ?? null,
    first_seen:     r.first_seen?.toISOString() ?? null,
    last_seen:      r.last_seen?.toISOString() ?? null,
    created_at:     r.created_at?.toISOString() ?? "",
  }));

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="vehicles.csv"');
    res.send(toCSV(data));
  } else {
    res.setHeader("Content-Disposition", 'attachment; filename="vehicles.json"');
    res.json({ count: data.length, exported_at: new Date().toISOString(), data });
  }
});

// ─── GET /export/access-events ────────────────────────────────────────────────

router.get("/access-events", requireAuth, async (req, res) => {
  const { format = "json", status, from, to, entrance_id } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (status) conditions.push(eq(accessEventsTable.status, status as any));
  if (entrance_id) conditions.push(eq(accessEventsTable.entrance_id, entrance_id));
  const fromDate = parseDate(from);
  const toDate   = parseDate(to);
  if (fromDate) conditions.push(gte(accessEventsTable.timestamp, fromDate));
  if (toDate)   conditions.push(lte(accessEventsTable.timestamp, toDate));

  const rows = await db
    .select({
      id: accessEventsTable.id,
      timestamp: accessEventsTable.timestamp,
      event_type: accessEventsTable.event_type,
      status: accessEventsTable.status,
      license_plate: accessEventsTable.license_plate,
      confidence_score: accessEventsTable.confidence_score,
      entrance: entrancesTable.name,
      notes: accessEventsTable.notes,
    })
    .from(accessEventsTable)
    .leftJoin(entrancesTable, eq(accessEventsTable.entrance_id, entrancesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${accessEventsTable.timestamp} desc`)
    .limit(10000);

  const data = rows.map((r) => ({
    ...r,
    timestamp: r.timestamp?.toISOString() ?? "",
  }));

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="access-events.csv"');
    res.send(toCSV(data));
  } else {
    res.setHeader("Content-Disposition", 'attachment; filename="access-events.json"');
    res.json({ count: data.length, exported_at: new Date().toISOString(), data });
  }
});

// ─── GET /export/logs ─────────────────────────────────────────────────────────

router.get("/logs", requireAuth, async (req, res) => {
  const { format = "json", log_type, from, to } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (log_type) conditions.push(eq(logsTable.log_type, log_type as any));
  const fromDate = parseDate(from);
  const toDate   = parseDate(to);
  if (fromDate) conditions.push(gte(logsTable.timestamp, fromDate));
  if (toDate)   conditions.push(lte(logsTable.timestamp, toDate));

  const rows = await db
    .select()
    .from(logsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${logsTable.timestamp} desc`)
    .limit(50000);

  const data = rows.map((r) => ({
    ...r,
    timestamp: r.timestamp?.toISOString() ?? "",
  }));

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="logs.csv"');
    res.send(toCSV(data));
  } else {
    res.setHeader("Content-Disposition", 'attachment; filename="logs.json"');
    res.json({ count: data.length, exported_at: new Date().toISOString(), data });
  }
});

export { router as exportRouter };
