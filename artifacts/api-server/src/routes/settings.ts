import { Router } from "express";
import { db } from "@workspace/db";
import { systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

const DEFAULT_SETTINGS = [
  { key: "ocr_confidence_threshold",   value: "0.65", value_type: "number",  label: "OCR Confidence Threshold",    description: "Minimum confidence score (0-1) for OCR to accept a plate reading", category: "ai" },
  { key: "ai_confidence_threshold",    value: "0.70", value_type: "number",  label: "AI Confidence Threshold",     description: "Minimum AI confidence score (0-1) to auto-allow vehicle access",   category: "ai" },
  { key: "gate_open_duration_ms",      value: "5000", value_type: "number",  label: "Gate Open Duration (ms)",     description: "How long the gate relay stays open (milliseconds)",                 category: "hardware" },
  { key: "auto_close_timeout_ms",      value: "30000",value_type: "number",  label: "Auto-Close Timeout (ms)",     description: "Time before the system auto-closes an open gate",                   category: "hardware" },
  { key: "snapshot_retention_days",    value: "90",   value_type: "number",  label: "Snapshot Retention (days)",   description: "Days before vehicle snapshots are automatically purged",            category: "storage" },
  { key: "event_retention_days",       value: "365",  value_type: "number",  label: "Event Retention (days)",      description: "Days before access events and domain events are purged",           category: "storage" },
  { key: "log_retention_days",         value: "180",  value_type: "number",  label: "Log Retention (days)",        description: "Days before system logs are pruned",                               category: "storage" },
  { key: "mock_mode_enabled",          value: "false",value_type: "boolean", label: "Mock Camera Mode",            description: "Enable the mock camera simulator (development only)",              category: "system" },
  { key: "debug_logging_enabled",      value: "false",value_type: "boolean", label: "Debug Logging",               description: "Enable verbose debug logging to the system log",                   category: "system" },
  { key: "checkin_grace_hours",        value: "2",    value_type: "number",  label: "Check-in Grace Period (hrs)", description: "Hours before check-in time when gate access opens",                 category: "access" },
  { key: "checkout_grace_hours",       value: "2",    value_type: "number",  label: "Check-out Grace Period (hrs)","description": "Hours after check-out time when gate access closes",             category: "access" },
  { key: "max_snapshots_per_vehicle",  value: "500",  value_type: "number",  label: "Max Snapshots per Vehicle",   description: "Maximum number of snapshots to keep per vehicle",                  category: "storage" },
  { key: "auto_blacklist_threshold",   value: "5",    value_type: "number",  label: "Auto-Blacklist Threshold",    description: "Number of consecutive denied attempts before flagging a vehicle",  category: "access" },
  { key: "ocr_max_candidates",         value: "3",    value_type: "number",  label: "OCR Max Candidates",          description: "Number of top OCR candidates to store per recognition event",      category: "ai" },
  { key: "site_name",                  value: "Villa Access Control", value_type: "string", label: "Site Name", description: "Name shown in the dashboard header and notifications", category: "general" },
];

async function ensureDefaults() {
  for (const s of DEFAULT_SETTINGS) {
    const existing = await db
      .select({ key: systemSettingsTable.key })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, s.key))
      .limit(1);
    if (!existing[0]) {
      await db.insert(systemSettingsTable).values(s);
    }
  }
}

// GET /settings — returns all settings grouped by category
router.get("/", requireAuth, async (_req, res) => {
  await ensureDefaults();
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(systemSettingsTable.category, systemSettingsTable.key);

  const grouped: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }

  res.json({ settings: rows, grouped });
});

// GET /settings/:key
router.get("/:key", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, req.params.key))
    .limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Setting not found" }); return; }
  res.json(rows[0]);
});

// PUT /settings/:key
router.put("/:key", requireAuth, async (req: any, res) => {
  const { value } = req.body;
  if (value === undefined || value === null) {
    res.status(400).json({ detail: "value is required" });
    return;
  }

  const existing = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, req.params.key))
    .limit(1);

  if (!existing[0]) {
    res.status(404).json({ detail: "Setting not found" });
    return;
  }

  const [updated] = await db
    .update(systemSettingsTable)
    .set({ value: String(value), updated_at: new Date(), updated_by: req.user?.id ?? null })
    .where(eq(systemSettingsTable.key, req.params.key))
    .returning();

  res.json(updated);
});

// PATCH /settings — bulk update
router.patch("/", requireAuth, async (req: any, res) => {
  const updates: Record<string, string> = req.body;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ detail: "Body must be an object of key→value pairs" });
    return;
  }

  const results = [];
  for (const [key, value] of Object.entries(updates)) {
    const existing = await db
      .select({ key: systemSettingsTable.key })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, key))
      .limit(1);
    if (!existing[0]) continue;

    const [updated] = await db
      .update(systemSettingsTable)
      .set({ value: String(value), updated_at: new Date(), updated_by: req.user?.id ?? null })
      .where(eq(systemSettingsTable.key, key))
      .returning();
    results.push(updated);
  }

  res.json({ updated: results.length, settings: results });
});

export { router as settingsRouter };
