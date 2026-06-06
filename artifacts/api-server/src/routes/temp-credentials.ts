import { Router } from "express";
import { db } from "@workspace/db";
import { tempCredentialsTable, reservationsTable, villasTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";
import { syncCredentialToIntercoms, revokeCredentialFromIntercoms } from "../services/staff-pin-sync";

const router = Router();

// Far-future sentinel for "permanent" PINs. Hikvision requires an end time, so
// permanent PINs are stored with this date and never auto-expire.
const PERMANENT_UNTIL = new Date("2099-12-31T23:59:59Z");

async function enrichCred(c: typeof tempCredentialsTable.$inferSelect) {
  let reservation = null;
  let villa = null;

  if (c.reservation_id) {
    const res = await db.select({ id: reservationsTable.id, guest_name: reservationsTable.guest_name, villa_id: reservationsTable.villa_id, pin_code: reservationsTable.pin_code })
      .from(reservationsTable).where(eq(reservationsTable.id, c.reservation_id)).limit(1);
    reservation = res[0] ?? null;

    if (reservation?.villa_id) {
      const villas = await db.select({ id: villasTable.id, name: villasTable.name }).from(villasTable).where(eq(villasTable.id, reservation.villa_id)).limit(1);
      villa = villas[0] ?? null;
    }
  }

  const now = new Date();
  let computedStatus = c.status;
  // Permanent PINs never expire; only window-bound (temporary) PINs do.
  if (c.status === "active" && c.access_type !== "permanent" && new Date(c.valid_until) < now) {
    computedStatus = "expired";
    await db.update(tempCredentialsTable).set({ status: "expired" }).where(eq(tempCredentialsTable.id, c.id));
  }

  return { ...c, status: computedStatus, reservation, villa };
}

// GET /temp-credentials
router.get("/", requireAuth, async (req, res) => {
  const { status } = req.query as { status?: string };
  const rows = await db.select().from(tempCredentialsTable).orderBy(desc(tempCredentialsTable.created_at));
  const enriched = await Promise.all(rows.map(enrichCred));
  const filtered = status && status !== "all" ? enriched.filter((c) => c.status === status) : enriched;
  res.json(filtered);
});

// GET /temp-credentials/:id
router.get("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  res.json(await enrichCred(rows[0]));
});

// POST /temp-credentials
//
// Two modes:
//   * Reservation-linked  — reservation_id provided (existing behaviour; the
//     reservation flow already pushes its PIN to hardware, so we DON'T push here).
//   * Standalone staff PIN — no reservation_id; owner_name (or label) required.
//     Pushed to all sync-enabled Hikvision intercoms via staff-pin-sync.
const createSchema = z.object({
  reservation_id: z.string().min(1).optional(),
  owner_name: z.string().optional(),
  access_type: z.enum(["temporary", "permanent"]).optional(),
  pin_code: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly 4 digits")
    .optional(),
  label: z.string().optional(),
  notes: z.string().optional(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
});

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

router.post("/", requireAuth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request", errors: body.error.issues }); return; }
  const d = body.data;

  const accessType = d.access_type ?? "temporary";
  const standalone = !d.reservation_id;

  // ── Reservation-linked ──────────────────────────────────────────────────
  if (!standalone) {
    const reservation = await db.select().from(reservationsTable).where(eq(reservationsTable.id, d.reservation_id!)).limit(1);
    if (!reservation[0]) { res.status(404).json({ detail: "Reservation not found" }); return; }
    if (!d.valid_from || !d.valid_until) { res.status(400).json({ detail: "valid_from and valid_until are required" }); return; }

    const [cred] = await db.insert(tempCredentialsTable).values({
      reservation_id: d.reservation_id!,
      pin_code: d.pin_code ?? generatePin(),
      label: d.label ?? null,
      notes: d.notes ?? null,
      // Reservation-linked PINs are always window-bound — never permanent — so
      // enrichCred's expiry logic keeps applying to the legacy path.
      access_type: "temporary",
      valid_from: new Date(d.valid_from),
      valid_until: new Date(d.valid_until),
      status: "active",
    }).returning();

    res.status(201).json(await enrichCred(cred));
    return;
  }

  // ── Standalone staff PIN ────────────────────────────────────────────────
  if (!d.owner_name && !d.label) {
    res.status(400).json({ detail: "owner_name (or label) is required for a standalone PIN" });
    return;
  }

  let validFrom: Date;
  let validUntil: Date;
  if (accessType === "permanent") {
    validFrom = d.valid_from ? new Date(d.valid_from) : new Date();
    validUntil = PERMANENT_UNTIL;
  } else {
    if (!d.valid_from || !d.valid_until) { res.status(400).json({ detail: "valid_from and valid_until are required for a temporary PIN" }); return; }
    validFrom = new Date(d.valid_from);
    validUntil = new Date(d.valid_until);
  }

  const [cred] = await db.insert(tempCredentialsTable).values({
    reservation_id: null,
    owner_name: d.owner_name ?? null,
    pin_code: d.pin_code ?? generatePin(),
    label: d.label ?? null,
    notes: d.notes ?? null,
    access_type: accessType,
    valid_from: validFrom,
    valid_until: validUntil,
    status: "active",
    sync_status: "pending",
  }).returning();

  // Push to Hikvision intercoms (updates sync_status). Best-effort: the row is
  // already persisted, so a device/network failure leaves sync_status='failed'
  // and the operator can retry by re-saving.
  try {
    await syncCredentialToIntercoms({
      id: cred.id,
      owner_name: cred.owner_name,
      label: cred.label,
      pin_code: cred.pin_code,
      valid_from: cred.valid_from,
      valid_until: cred.valid_until,
    }, req.user?.id);
  } catch (err) {
    console.error(`[temp-credentials] standalone intercom push threw for ${cred.id}:`, err);
  }

  const fresh = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, cred.id)).limit(1);
  res.status(201).json(await enrichCred(fresh[0] ?? cred));
});

// PATCH /temp-credentials/:id
const updateSchema = z.object({
  owner_name: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  const body = updateSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ detail: "Invalid request" }); return; }

  const updates: Record<string, unknown> = {};
  if (body.data.owner_name !== undefined) updates.owner_name = body.data.owner_name;
  if (body.data.label !== undefined) updates.label = body.data.label;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.valid_from) updates.valid_from = new Date(body.data.valid_from);
  if (body.data.valid_until) updates.valid_until = new Date(body.data.valid_until);

  const [updated] = await db.update(tempCredentialsTable).set(updates).where(eq(tempCredentialsTable.id, req.params.id)).returning();

  // For standalone active PINs, re-push to intercoms when the window changed so
  // the device record reflects the new validity.
  const windowChanged = body.data.valid_from !== undefined || body.data.valid_until !== undefined;
  if (!updated.reservation_id && updated.status === "active" && windowChanged) {
    try {
      await syncCredentialToIntercoms({
        id: updated.id,
        owner_name: updated.owner_name,
        label: updated.label,
        pin_code: updated.pin_code,
        valid_from: updated.valid_from,
        valid_until: updated.valid_until,
      }, req.user?.id);
    } catch (err) {
      console.error(`[temp-credentials] standalone re-sync threw for ${updated.id}:`, err);
    }
  }

  const fresh = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  res.json(await enrichCred(fresh[0] ?? updated));
});

// POST /temp-credentials/:id/revoke
router.post("/:id/revoke", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  // Standalone PINs live on the intercoms — pull them off the devices first.
  if (!rows[0].reservation_id) {
    try { await revokeCredentialFromIntercoms({ id: rows[0].id }, req.user?.id); }
    catch (err) { console.error(`[temp-credentials] revoke from intercoms threw for ${rows[0].id}:`, err); }
  }

  const [updated] = await db.update(tempCredentialsTable).set({ status: "revoked" })
    .where(eq(tempCredentialsTable.id, req.params.id)).returning();
  res.json(await enrichCred(updated));
});

// DELETE /temp-credentials/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const rows = await db.select().from(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }

  // Standalone active/expired PINs may still have a device record — clean it up.
  if (!rows[0].reservation_id && rows[0].status !== "revoked") {
    try { await revokeCredentialFromIntercoms({ id: rows[0].id }, req.user?.id); }
    catch (err) { console.error(`[temp-credentials] revoke-before-delete threw for ${rows[0].id}:`, err); }
  }

  await db.delete(tempCredentialsTable).where(eq(tempCredentialsTable.id, req.params.id));
  res.status(204).send();
});

export { router as tempCredentialsRouter };
