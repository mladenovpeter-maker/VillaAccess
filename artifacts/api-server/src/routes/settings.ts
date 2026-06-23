import { Router } from "express";
import { db } from "@workspace/db";
import { systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { sendEmail, emailWrap, getReportRecipients } from "../services/emailService";
import { getLateArrivals, getEarlyDepartures } from "../services/reportService";
import { runMorningReport, runEveningReport } from "../cron/reports";

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
  { key: "reports_enabled",            value: "false",  value_type: "boolean",  label: "Активирай имейл отчети",         description: "Изпраща ежедневни отчети за закъснели и напуснали рано",              category: "email" },
  { key: "smtp_host",                  value: "",       value_type: "string",   label: "SMTP Хост",                      description: "Напр. smtp.zoho.com или smtp.gmail.com",                            category: "email" },
  { key: "smtp_port",                  value: "587",    value_type: "number",   label: "SMTP Порт",                      description: "465 за SSL, 587 за STARTTLS",                                       category: "email" },
  { key: "smtp_secure",                value: "false",  value_type: "boolean",  label: "SSL/TLS (порт 465)",             description: "Включи за порт 465; изключи за STARTTLS (587)",                     category: "email" },
  { key: "smtp_user",                  value: "",       value_type: "string",   label: "SMTP Потребител",                description: "Имейл адресът от който се изпраща",                                 category: "email" },
  { key: "smtp_pass",                  value: "",       value_type: "password", label: "SMTP Парола",                    description: "Паролата за SMTP автентикация",                                     category: "email" },
  { key: "smtp_from",                  value: "",       value_type: "string",   label: "Изпращач (From)",               description: "Напр. MakmetalAccess <reports@nexaraz.net>",                        category: "email" },
  { key: "report_recipients",          value: "",       value_type: "string",   label: "Получатели (CSV)",               description: "Имейли разделени със запетая: hr@firm.bg,boss@firm.bg",            category: "email" },
  { key: "report_morning_time",        value: "09:30",  value_type: "string",   label: "Час сутрешен отчет (HH:MM)",    description: "Кога да се изпрати отчетът за закъснели — по сървърно локално време", category: "email" },
  { key: "report_evening_time",        value: "18:30",  value_type: "string",   label: "Час вечерен отчет (HH:MM)",     description: "Кога да се изпрати дневното резюме — по сървърно локално време",      category: "email" },
  { key: "report_late_grace_minutes",  value: "15",     value_type: "number",   label: "Толеранс закъснение (мин)",     description: "Минути след началото на смяната преди да се счита за закъснение",   category: "email" },
  { key: "report_early_grace_minutes", value: "15",     value_type: "number",   label: "Толеранс ранно напускане (мин)","description": "Минути преди края на смяната преди да се счита за ранно напускане", category: "email" },
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

// POST /settings/trigger-morning — immediately fires the morning late-arrivals report (ignores reports_enabled)
router.post("/trigger-morning", requireAuth, async (_req, res) => {
  try {
    const recipients = await getReportRecipients();
    if (!recipients.length) {
      res.status(400).json({ detail: "Няма конфигурирани получатели (report_recipients)" });
      return;
    }
    const today = new Date();
    const entries = await getLateArrivals(today);
    const rows = entries.map((e) => {
      const badge = e.status === "absent"
        ? `<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">Отсъстващ</span>`
        : `<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">Закъснял с ${e.minutesDiff} мин</span>`;
      const t = e.eventTime ? `${String(e.eventTime.getHours()).padStart(2,"0")}:${String(e.eventTime.getMinutes()).padStart(2,"0")}` : "—";
      return `<tr><td><strong>${e.fullName}</strong><br/><span style="color:#64748b;font-size:12px">${e.position??""}</span></td><td>${e.department??""}</td><td>${e.shiftStart}</td><td>${t}</td><td>${badge}</td></tr>`;
    }).join("");
    const table = entries.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#f1f5f9"><th style="padding:10px 12px;text-align:left">Работник</th><th style="padding:10px 12px;text-align:left">Отдел</th><th style="padding:10px 12px;text-align:left">Начало</th><th style="padding:10px 12px;text-align:left">Влизане</th><th style="padding:10px 12px;text-align:left">Статус</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p style="text-align:center;color:#94a3b8;padding:32px 0">✅ Няма закъснели или отсъстващи.</p>`;
    const body = `<h2 style="margin-top:0;color:#1e3a5f">🕐 Тест — Закъснели работници</h2><p style="color:#64748b;font-size:13px">Ръчно задействан тест — ${new Date().toLocaleDateString("bg-BG")}</p>${table}`;
    await sendEmail(recipients, `🕐 [ТЕСТ] Закъснели — ${new Date().toLocaleDateString("bg-BG")}`, emailWrap("Тест: Закъснели", body));
    res.json({ message: `Изпратен до: ${recipients.join(", ")} — ${entries.length} записа`, count: entries.length });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message ?? "Грешка" });
  }
});

// POST /settings/trigger-evening — immediately fires the evening summary report
router.post("/trigger-evening", requireAuth, async (_req, res) => {
  try {
    const recipients = await getReportRecipients();
    if (!recipients.length) {
      res.status(400).json({ detail: "Няма конфигурирани получатели (report_recipients)" });
      return;
    }
    const today = new Date();
    const [lateEntries, earlyEntries] = await Promise.all([getLateArrivals(today), getEarlyDepartures(today)]);

    function badge(color: string, bg: string, text: string) {
      return `<span style="background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">${text}</span>`;
    }
    function fmt(d: Date) { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

    const lateRows = lateEntries.map((e) => {
      const b = e.status === "absent" ? badge("#64748b","#f1f5f9","Отсъстващ") : badge("#dc2626","#fee2e2",`Закъснял ${e.minutesDiff} мин`);
      return `<tr><td><strong>${e.fullName}</strong></td><td>${e.department??""}</td><td>${e.shiftStart}</td><td>${e.eventTime?fmt(e.eventTime):"—"}</td><td>${b}</td></tr>`;
    }).join("");
    const earlyRows = earlyEntries.map((e) => {
      const b = badge("#d97706","#fef3c7",`Излязъл ${e.minutesDiff} мин рано`);
      return `<tr><td><strong>${e.fullName}</strong></td><td>${e.department??""}</td><td>${e.shiftEnd}</td><td>${e.eventTime?fmt(e.eventTime):"—"}</td><td>${b}</td></tr>`;
    }).join("");

    const thStyle = `style="padding:10px 12px;text-align:left;background:#f1f5f9"`;
    const tdStyle = `style="padding:10px 12px;border-bottom:1px solid #f1f5f9"`;
    const thead = `<thead><tr><th ${thStyle}>Работник</th><th ${thStyle}>Отдел</th><th ${thStyle}>Смяна</th><th ${thStyle}>Час</th><th ${thStyle}>Статус</th></tr></thead>`;
    const lateTable = lateEntries.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${thead}<tbody>${lateRows}</tbody></table>` : `<p style="text-align:center;color:#94a3b8;padding:24px 0">✅ Няма закъснели.</p>`;
    const earlyTable = earlyEntries.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${thead}<tbody>${earlyRows}</tbody></table>` : `<p style="text-align:center;color:#94a3b8;padding:24px 0">✅ Няма напуснали рано.</p>`;

    const body = `<h2 style="margin-top:0;color:#1e3a5f">📊 Тест — Дневно резюме</h2><p style="color:#64748b;font-size:13px">Ръчно задействан тест — ${new Date().toLocaleDateString("bg-BG")}</p><h3 style="color:#dc2626">🕐 Закъснели / Отсъстващи</h3>${lateTable}<h3 style="color:#d97706;margin-top:28px">🚪 Напуснали преди края на смяната</h3>${earlyTable}`;
    await sendEmail(recipients, `📊 [ТЕСТ] Дневен отчет — ${new Date().toLocaleDateString("bg-BG")}`, emailWrap("Тест: Дневен отчет", body));
    res.json({ message: `Изпратен до: ${recipients.join(", ")}`, late: lateEntries.length, early: earlyEntries.length });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message ?? "Грешка" });
  }
});

// POST /settings/test-email — sends a test email using current SMTP settings
router.post("/test-email", requireAuth, async (_req, res) => {
  try {
    const recipients = await getReportRecipients();
    if (!recipients.length) {
      res.status(400).json({ detail: "Няма конфигурирани получатели (report_recipients)" });
      return;
    }

    const body = `
      <h2 style="margin-top:0;color:#1e3a5f">Тест имейл</h2>
      <p>Това е тестово съобщение от <strong>MakmetalAccess</strong>.</p>
      <p>SMTP конфигурацията е успешна! ✅</p>
      <p style="color:#64748b;font-size:13px">Изпратено: ${new Date().toLocaleString("bg-BG")}</p>
    `;

    await sendEmail(
      recipients,
      "✅ MakmetalAccess — тест на SMTP конфигурацията",
      emailWrap("Тест имейл", body),
    );

    res.json({ message: `Тест имейл изпратен до: ${recipients.join(", ")}` });
  } catch (err: any) {
    res.status(500).json({ detail: err?.message ?? "Неуспешно изпращане" });
  }
});

export { router as settingsRouter };
