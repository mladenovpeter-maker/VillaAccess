import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { systemSettingsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

const SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "smtp_secure"];

async function getSmtpSettings(): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, SMTP_KEYS));

  const s: Record<string, string> = {};
  for (const row of rows) s[row.key] = row.value;
  return s;
}

export async function getSettingValue(key: string): Promise<string> {
  const rows = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  return rows[0]?.value ?? "";
}

export async function getReportRecipients(): Promise<string[]> {
  const val = await getSettingValue("report_recipients");
  return val.split(",").map((e) => e.trim()).filter(Boolean);
}

export async function isReportsEnabled(): Promise<boolean> {
  const val = await getSettingValue("reports_enabled");
  return val === "true";
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> {
  const s = await getSmtpSettings();

  if (!s["smtp_host"] || !s["smtp_user"] || !s["smtp_pass"]) {
    throw new Error("SMTP не е конфигуриран — попълнете настройките в Настройки → Имейл");
  }

  const transporter = nodemailer.createTransport({
    host: s["smtp_host"],
    port: Number(s["smtp_port"] ?? 587),
    secure: s["smtp_secure"] === "true",
    auth: { user: s["smtp_user"], pass: s["smtp_pass"] },
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: s["smtp_from"] || s["smtp_user"],
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
  });
}

export function emailWrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; color: #1a1a2e; }
  .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 28px 32px; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
  .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.85; }
  .body { padding: 28px 32px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
  th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-red { background: #fee2e2; color: #dc2626; }
  .badge-orange { background: #fef3c7; color: #d97706; }
  .badge-gray { background: #f1f5f9; color: #64748b; }
  .footer { background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  .empty { text-align: center; color: #94a3b8; padding: 32px 0; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>MakmetalAccess</h1>
    <p>${title}</p>
  </div>
  <div class="body">
    ${body}
  </div>
  <div class="footer">
    Автоматично генериран отчет от MakmetalAccess &bull; ${new Date().toLocaleDateString("bg-BG")}
  </div>
</div>
</body>
</html>`;
}
