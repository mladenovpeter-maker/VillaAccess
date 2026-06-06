/**
 * Smart-locks CRUD + read-only Tuya-backed status/events.
 *
 * Phase 1 endpoints:
 *   GET    /api/locks                 — list all locks (DB only, no Tuya call)
 *   GET    /api/locks/:id             — one lock
 *   POST   /api/locks                 — admin: create
 *   PATCH  /api/locks/:id             — admin: update
 *   DELETE /api/locks/:id             — admin: delete
 *   GET    /api/locks/:id/status      — LIVE Tuya status (online/battery/last_seen)
 *                                       + persists to DB row for System Health
 *   GET    /api/locks/:id/events?page=&page_size=
 *                                     — LIVE Tuya open-records (recent unlocks)
 *
 * No writes to the lock itself — that's Phase 2 (PINs) and beyond.
 *
 * Phase 1 explicitly avoids touching pin-sync.ts, reservations.ts,
 * intercoms.ts, cameras.ts, anpr.ts, or any existing schema.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  smartLocksTable,
  villasTable,
  smartLockPasswordsTable,
  reservationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireWriteAccess, requireRole } from "./auth";

const adminOnly = requireRole("admin");
void requireWriteAccess;
import { createLockAdapter } from "../lib/locks/factory";
import {
  isTuyaConfigured,
  TuyaApiError,
  TuyaConfigError,
} from "../lib/locks/tuya/client";

const router = Router();

// ─── Serialise ───────────────────────────────────────────────────────────────

function serializeLock(l: typeof smartLocksTable.$inferSelect) {
  return {
    id: l.id,
    name: l.name,
    villa_id: l.villa_id,
    protocol: l.protocol,
    tuya_device_id: l.tuya_device_id,
    status: l.status,
    battery_pct: l.battery_pct,
    last_seen: l.last_seen,
    last_status_check: l.last_status_check,
    last_status_latency_ms: l.last_status_latency_ms,
    device_info: l.device_info
      ? (() => {
          try {
            return JSON.parse(l.device_info!);
          } catch {
            return null;
          }
        })()
      : null,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

async function loadLock(id: string) {
  const rows = await db
    .select()
    .from(smartLocksTable)
    .where(eq(smartLocksTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

function handleTuyaError(err: unknown, res: Parameters<Parameters<typeof router.get>[2]>[1]): void {
  if (err instanceof TuyaConfigError) {
    res.status(503).json({ detail: err.message });
    return;
  }
  if (err instanceof TuyaApiError) {
    res
      .status(502)
      .json({ detail: err.message, tuya_code: err.code, tuya_path: err.path });
    return;
  }
  const msg = (err as Error)?.message ?? "Unknown error";
  res.status(500).json({ detail: msg });
}

// ─── GET /locks ──────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const locks = await db
    .select()
    .from(smartLocksTable)
    .orderBy(smartLocksTable.name);
  res.json(locks.map(serializeLock));
});

// ─── GET /locks/:id ──────────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  res.json(serializeLock(l));
});

// ─── POST /locks (admin) ─────────────────────────────────────────────────────

router.post("/", requireAuth, adminOnly, async (req, res) => {
  const { name, villa_id, protocol, tuya_device_id } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ detail: "name is required" });
    return;
  }
  const proto = (protocol ?? "tuya") as "tuya";
  if (proto !== "tuya") {
    res.status(400).json({ detail: `Unsupported protocol "${proto}"` });
    return;
  }
  if (proto === "tuya" && (!tuya_device_id || typeof tuya_device_id !== "string")) {
    res.status(400).json({ detail: "tuya_device_id is required for protocol=tuya" });
    return;
  }
  if (villa_id) {
    const v = await db
      .select({ id: villasTable.id })
      .from(villasTable)
      .where(eq(villasTable.id, villa_id))
      .limit(1);
    if (v.length === 0) {
      res.status(400).json({ detail: "villa_id does not exist" });
      return;
    }
    const existing = await db
      .select({ id: smartLocksTable.id })
      .from(smartLocksTable)
      .where(eq(smartLocksTable.villa_id, villa_id))
      .limit(1);
    if (existing.length > 0) {
      res
        .status(409)
        .json({ detail: "This villa already has a smart lock assigned" });
      return;
    }
  }

  try {
    const inserted = await db
      .insert(smartLocksTable)
      .values({
        name,
        villa_id: villa_id ?? null,
        protocol: proto,
        tuya_device_id: tuya_device_id ?? null,
      })
      .returning();
    res.status(201).json(serializeLock(inserted[0]));
  } catch (err) {
    res.status(500).json({ detail: (err as Error).message });
  }
});

// ─── PATCH /locks/:id (admin) ────────────────────────────────────────────────

router.patch("/:id", requireAuth, adminOnly, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  const { name, villa_id, tuya_device_id } = req.body ?? {};
  const updates: Partial<typeof smartLocksTable.$inferInsert> = {
    updated_at: new Date(),
  };
  if (typeof name === "string" && name.length > 0) updates.name = name;
  if (typeof tuya_device_id === "string") updates.tuya_device_id = tuya_device_id;
  if (villa_id !== undefined) {
    if (villa_id !== null) {
      const v = await db
        .select({ id: villasTable.id })
        .from(villasTable)
        .where(eq(villasTable.id, villa_id))
        .limit(1);
      if (v.length === 0) {
        res.status(400).json({ detail: "villa_id does not exist" });
        return;
      }
      const existing = await db
        .select({ id: smartLocksTable.id })
        .from(smartLocksTable)
        .where(eq(smartLocksTable.villa_id, villa_id))
        .limit(1);
      if (existing.length > 0 && existing[0].id !== l.id) {
        res
          .status(409)
          .json({ detail: "This villa already has a smart lock assigned" });
        return;
      }
    }
    updates.villa_id = villa_id;
  }

  const updated = await db
    .update(smartLocksTable)
    .set(updates)
    .where(eq(smartLocksTable.id, l.id))
    .returning();
  res.json(serializeLock(updated[0]));
});

// ─── DELETE /locks/:id (admin) ───────────────────────────────────────────────

router.delete("/:id", requireAuth, adminOnly, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  await db.delete(smartLocksTable).where(eq(smartLocksTable.id, l.id));
  res.status(204).end();
});

// ─── GET /locks/:id/status — LIVE Tuya probe ─────────────────────────────────

router.get("/:id/status", requireAuth, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  if (!isTuyaConfigured()) {
    res.status(503).json({
      detail:
        "Tuya not configured — set TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_REGION in .env.docker",
    });
    return;
  }

  const t0 = Date.now();
  try {
    const adapter = createLockAdapter(l);
    const status = await adapter.getStatus();
    const latency_ms = Date.now() - t0;

    // Persist runtime fields back to DB for System Health card.
    await db
      .update(smartLocksTable)
      .set({
        status: status.online ? "online" : "offline",
        battery_pct: status.battery_pct,
        last_seen: status.last_seen_at ? new Date(status.last_seen_at) : null,
        last_status_check: new Date(),
        last_status_latency_ms: latency_ms,
        device_info: JSON.stringify(status.raw).slice(0, 8192),
        updated_at: new Date(),
      })
      .where(eq(smartLocksTable.id, l.id));

    res.json({
      online: status.online,
      battery_pct: status.battery_pct,
      last_seen_at: status.last_seen_at,
      latency_ms,
    });
  } catch (err) {
    // Mark as error in DB so System Health reflects it.
    await db
      .update(smartLocksTable)
      .set({
        status: "error",
        last_status_check: new Date(),
        last_status_latency_ms: Date.now() - t0,
        updated_at: new Date(),
      })
      .where(eq(smartLocksTable.id, l.id))
      .catch(() => {/* don't mask the original error */});
    handleTuyaError(err, res);
  }
});

// ─── GET /locks/:id/events — LIVE Tuya open-records ──────────────────────────

router.get("/:id/events", requireAuth, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  if (!isTuyaConfigured()) {
    res.status(503).json({
      detail:
        "Tuya not configured — set TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_REGION in .env.docker",
    });
    return;
  }

  const page = req.query.page ? Number(req.query.page) : 1;
  const page_size = req.query.page_size ? Number(req.query.page_size) : 20;
  if (!Number.isFinite(page) || page < 1) {
    res.status(400).json({ detail: "page must be >= 1" });
    return;
  }
  if (!Number.isFinite(page_size) || page_size < 1 || page_size > 100) {
    res.status(400).json({ detail: "page_size must be 1..100" });
    return;
  }

  try {
    const adapter = createLockAdapter(l);
    const records = await adapter.listOpenRecords({ page, page_size });
    res.json({ records, page, page_size, count: records.length });
  } catch (err) {
    handleTuyaError(err, res);
  }
});

// ─── GET /locks/:id/passwords — LIVE Tuya temp-passwords + ledger cross-ref ───
//
// Answers the question "are the guest PINs REALLY on the lock?" by listing the
// temp-passwords that physically exist on the device right now (live Tuya call)
// and cross-referencing each against the smart_lock_passwords ledger so the UI
// can show which PIN belongs to which reservation/guest, and — crucially —
// surface any PIN our system believes is active but is MISSING from the device
// (guest would be locked out). Read-only; does not touch lock-sync push/revoke.

router.get("/:id/passwords", requireAuth, async (req, res) => {
  const l = await loadLock(req.params.id);
  if (!l) {
    res.status(404).json({ detail: "Smart lock not found" });
    return;
  }
  if (!isTuyaConfigured()) {
    res.status(503).json({
      detail:
        "Tuya not configured — set TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_REGION in .env.docker",
    });
    return;
  }

  try {
    const adapter = createLockAdapter(l);
    const devicePasswords = await adapter.listTempPasswords();

    // Ledger rows this lock knows about, enriched with the guest they belong to.
    const ledger = await db
      .select({
        provider_password_id: smartLockPasswordsTable.provider_password_id,
        ledger_status: smartLockPasswordsTable.status,
        reservation_id: smartLockPasswordsTable.reservation_id,
        guest_name: reservationsTable.guest_name,
        check_in: reservationsTable.check_in,
        check_out: reservationsTable.check_out,
      })
      .from(smartLockPasswordsTable)
      .innerJoin(
        reservationsTable,
        eq(reservationsTable.id, smartLockPasswordsTable.reservation_id),
      )
      .where(eq(smartLockPasswordsTable.smart_lock_id, l.id));

    const byPid = new Map(ledger.map((r) => [String(r.provider_password_id), r]));

    const passwords = devicePasswords.map((p) => {
      const m = byPid.get(String(p.password_id));
      return {
        password_id: p.password_id,
        name: p.name,
        effective_time: p.effective_time,
        invalid_time: p.invalid_time,
        status: p.status,
        managed: !!m,
        reservation_id: m?.reservation_id ?? null,
        guest_name: m?.guest_name ?? null,
        ledger_status: m?.ledger_status ?? null,
      };
    });

    // PINs our system thinks are active but are NOT physically on the device —
    // these guests would be unable to unlock. The most actionable signal here.
    const devicePids = new Set(devicePasswords.map((p) => String(p.password_id)));
    const missing = ledger
      .filter(
        (r) => r.ledger_status === "active" && !devicePids.has(String(r.provider_password_id)),
      )
      .map((r) => ({
        provider_password_id: r.provider_password_id,
        reservation_id: r.reservation_id,
        guest_name: r.guest_name,
        check_in: r.check_in,
        check_out: r.check_out,
      }));

    res.json({ passwords, missing, count: passwords.length });
  } catch (err) {
    handleTuyaError(err, res);
  }
});

export const locksRouter = router;
export default router;
