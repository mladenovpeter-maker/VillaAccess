import cron from "node-cron";
import { sendEmail, emailWrap, getReportRecipients, isReportsEnabled, getSettingValue } from "../services/emailService";
import { getLateArrivals, getEarlyDepartures, WorkerReportEntry } from "../services/reportService";
import { logger } from "../lib/logger";

function pad(n: number) { return String(n).padStart(2, "0"); }

function currentHHMM(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)}ч ${min % 60}мин`;
}

function todayBG(): string {
  return new Date().toLocaleDateString("bg-BG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function buildLateTable(entries: WorkerReportEntry[]): string {
  if (!entries.length) {
    return `<p class="empty">✅ Няма закъснели или отсъстващи работници с регистрирана смяна.</p>`;
  }

  const rows = entries.map((e) => {
    const badge = e.status === "absent"
      ? `<span class="badge badge-gray">Отсъстващ</span>`
      : `<span class="badge badge-red">Закъснял с ${formatMinutes(e.minutesDiff!)}</span>`;
    const entryCell = e.eventTime ? formatTime(e.eventTime) : "—";
    return `<tr>
      <td><strong>${e.fullName}</strong><br/><span style="color:#64748b;font-size:12px">${e.position ?? ""}</span></td>
      <td>${e.department ?? "—"}</td>
      <td>${e.shiftStart}</td>
      <td>${entryCell}</td>
      <td>${badge}</td>
    </tr>`;
  }).join("");

  return `<table>
    <thead><tr>
      <th>Работник</th><th>Отдел</th><th>Начало смяна</th><th>Влизане</th><th>Статус</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildEarlyTable(entries: WorkerReportEntry[]): string {
  if (!entries.length) {
    return `<p class="empty">✅ Няма работници напуснали преди края на смяната.</p>`;
  }

  const rows = entries.map((e) => {
    const badge = `<span class="badge badge-orange">Излязъл ${formatMinutes(e.minutesDiff!)} рано</span>`;
    const exitCell = e.eventTime ? formatTime(e.eventTime) : "—";
    return `<tr>
      <td><strong>${e.fullName}</strong><br/><span style="color:#64748b;font-size:12px">${e.position ?? ""}</span></td>
      <td>${e.department ?? "—"}</td>
      <td>${e.shiftEnd}</td>
      <td>${exitCell}</td>
      <td>${badge}</td>
    </tr>`;
  }).join("");

  return `<table>
    <thead><tr>
      <th>Работник</th><th>Отдел</th><th>Край смяна</th><th>Излизане</th><th>Статус</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function runMorningReport() {
  try {
    const enabled = await isReportsEnabled();
    if (!enabled) return;

    const recipients = await getReportRecipients();
    if (!recipients.length) {
      logger.warn("[cron] Morning report: no recipients configured");
      return;
    }

    logger.info("[cron] Running morning late-arrivals report");

    const today = new Date();
    const entries = await getLateArrivals(today);
    const table = buildLateTable(entries);
    const dateStr = todayBG();

    const body = `
      <h2 style="margin-top:0;color:#1e3a5f">Сутрешен отчет — Закъснели</h2>
      <p style="color:#64748b;font-size:14px">${dateStr}</p>
      <p style="font-size:14px">Работници закъснели или без регистрирано влизане към момента на отчета:</p>
      ${table}
    `;

    await sendEmail(
      recipients,
      `🕐 Закъснели работници — ${new Date().toLocaleDateString("bg-BG")}`,
      emailWrap(`Сутрешен отчет — ${new Date().toLocaleDateString("bg-BG")}`, body),
    );

    logger.info(`[cron] Morning report sent to ${recipients.join(", ")} — ${entries.length} entries`);
  } catch (err) {
    logger.error({ err }, "[cron] Morning report failed");
  }
}

async function runEveningReport() {
  try {
    const enabled = await isReportsEnabled();
    if (!enabled) return;

    const recipients = await getReportRecipients();
    if (!recipients.length) {
      logger.warn("[cron] Evening report: no recipients configured");
      return;
    }

    logger.info("[cron] Running evening early-departures report");

    const today = new Date();
    const lateEntries = await getLateArrivals(today);
    const earlyEntries = await getEarlyDepartures(today);

    const dateStr = todayBG();

    const body = `
      <h2 style="margin-top:0;color:#1e3a5f">Вечерен отчет — Дневно резюме</h2>
      <p style="color:#64748b;font-size:14px">${dateStr}</p>

      <h3 style="color:#dc2626;margin-top:24px">🕐 Закъснели / Отсъстващи</h3>
      ${buildLateTable(lateEntries)}

      <h3 style="color:#d97706;margin-top:32px">🚪 Напуснали преди края на смяната</h3>
      ${buildEarlyTable(earlyEntries)}
    `;

    await sendEmail(
      recipients,
      `📊 Дневен отчет — ${new Date().toLocaleDateString("bg-BG")}`,
      emailWrap(`Вечерен отчет — ${new Date().toLocaleDateString("bg-BG")}`, body),
    );

    logger.info(`[cron] Evening report sent to ${recipients.join(", ")}`);
  } catch (err) {
    logger.error({ err }, "[cron] Evening report failed");
  }
}

export function startReportCron() {
  cron.schedule("* * * * *", async () => {
    const now = currentHHMM();

    const [morningTime, eveningTime] = await Promise.all([
      getSettingValue("report_morning_time"),
      getSettingValue("report_evening_time"),
    ]);

    if (morningTime && now === morningTime) {
      await runMorningReport();
    }
    if (eveningTime && now === eveningTime) {
      await runEveningReport();
    }
  });

  logger.info("[cron] Report cron scheduler started (checking every minute)");
}
