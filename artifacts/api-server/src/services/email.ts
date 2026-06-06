import nodemailer, { type Transporter } from "nodemailer";
import QRCode from "qrcode";
import { logger } from "../lib/logger";

/**
 * Guest reservation email (PIN + details) — purely additive notification layer.
 * Does NOT touch reservation matching / validation / sync. Self-hosted friendly:
 * configured entirely through SMTP_* env vars in the user's .env.docker.
 */

const log = logger.child({ mod: "email" });

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_FROM"));
}

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const host = env("SMTP_HOST");
  const from = env("SMTP_FROM");
  if (!host || !from) {
    throw new Error("SMTP is not configured (SMTP_HOST / SMTP_FROM missing).");
  }
  const port = Number(env("SMTP_PORT") ?? "587");
  // Explicit SMTP_SECURE wins; otherwise infer TLS-on-connect for port 465.
  const secureEnv = env("SMTP_SECURE");
  const secure = secureEnv ? secureEnv === "true" : port === 465;
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  return cachedTransport;
}

// ── Reservation shape (subset of enrichReservation output) ─────────────────────
export interface ReservationEmailData {
  id: string;
  guest_name: string;
  guest_email: string | null;
  check_in: Date | string;
  check_out: Date | string;
  pin_code: string | null;
  pin_valid_from?: Date | string | null;
  pin_valid_to?: Date | string | null;
  villa?: { name?: string | null } | null;
  vehicles?: Array<{ license_plate: string; make?: string | null; model?: string | null; color?: string | null }>;
}

type Lang = "bg" | "en";

const TZ = env("DISPLAY_TIMEZONE") ?? "Europe/Sofia";

function fmt(d: Date | string | null | undefined, lang: Lang): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const STR = {
  bg: {
    subject: (villa: string) => `Вашата резервация${villa ? ` във ${villa}` : ""} — код за достъп`,
    hello: (name: string) => `Здравейте, ${name}!`,
    intro: "Радваме се да Ви посрещнем. По-долу са детайлите за Вашия престой и кодът за достъп до имота.",
    villa: "Имот",
    period: "Период",
    checkIn: "Настаняване",
    checkOut: "Напускане",
    pin: "Код за достъп (ПИН)",
    pinHint: "Въведете този код на таблото на входа / домофона.",
    vehicles: "Регистрирани автомобили",
    qrHint: "Сканирайте QR кода за бърз достъп до кода.",
    noPin: "Кодът ще бъде наличен скоро.",
    footer: "Това е автоматично съобщение. При въпроси, моля отговорете на този имейл.",
  },
  en: {
    subject: (villa: string) => `Your reservation${villa ? ` at ${villa}` : ""} — access code`,
    hello: (name: string) => `Hello, ${name}!`,
    intro: "We look forward to welcoming you. Below are your stay details and the access code for the property.",
    villa: "Property",
    period: "Period",
    checkIn: "Check-in",
    checkOut: "Check-out",
    pin: "Access code (PIN)",
    pinHint: "Enter this code on the keypad at the entrance / intercom.",
    vehicles: "Registered vehicles",
    qrHint: "Scan the QR code for quick access to your code.",
    noPin: "Your code will be available shortly.",
    footer: "This is an automated message. If you have questions, simply reply to this email.",
  },
} as const;

const GOLD = "#f59e0b";
const INK = "#1a1a1a";
const MUTED = "#6b7280";

function buildHtml(r: ReservationEmailData, lang: Lang, hasQr: boolean): string {
  const s = STR[lang];
  const villaName = r.villa?.name ?? "";
  const vehicles = (r.vehicles ?? []).filter((v) => v.license_plate);
  const vehiclesHtml = vehicles.length
    ? vehicles
        .map((v) => {
          const desc = [v.make, v.model, v.color].filter(Boolean).join(" ");
          return `<tr><td style="padding:4px 0;font-family:monospace;font-size:16px;font-weight:bold;color:${INK}">${esc(
            v.license_plate,
          )}</td><td style="padding:4px 0 4px 12px;color:${MUTED};font-size:13px">${esc(desc)}</td></tr>`;
        })
        .join("")
    : "";

  const pinBlock = r.pin_code
    ? `<div style="font-size:40px;letter-spacing:12px;font-weight:800;color:${INK};font-family:monospace;text-align:center;padding:8px 0">${esc(
        r.pin_code,
      )}</div>
       <div style="color:${MUTED};font-size:13px;text-align:center">${esc(s.pinHint)}</div>`
    : `<div style="color:${MUTED};font-size:14px;text-align:center;padding:12px 0">${esc(s.noPin)}</div>`;

  const qrBlock =
    hasQr && r.pin_code
      ? `<div style="text-align:center;padding-top:16px">
           <img src="cid:reservation-qr" width="160" height="160" alt="QR" style="border:1px solid #eee;border-radius:8px;padding:8px;background:#fff" />
           <div style="color:${MUTED};font-size:12px;margin-top:6px">${esc(s.qrHint)}</div>
         </div>`
      : "";

  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <tr><td style="background:${INK};padding:24px 28px">
      <div style="color:${GOLD};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Villa Access</div>
      <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px">${esc(s.hello(r.guest_name))}</div>
    </td></tr>
    <tr><td style="padding:24px 28px">
      <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 20px">${esc(s.intro)}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
        ${villaName ? row(s.villa, esc(villaName)) : ""}
        ${row(s.checkIn, fmt(r.check_in, lang))}
        ${row(s.checkOut, fmt(r.check_out, lang))}
      </table>

      <div style="border:2px solid ${GOLD};border-radius:12px;padding:18px;background:#fffbeb">
        <div style="color:${MUTED};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:center">${esc(
          s.pin,
        )}</div>
        ${pinBlock}
        ${qrBlock}
      </div>

      ${
        vehiclesHtml
          ? `<div style="margin-top:24px">
               <div style="color:${INK};font-size:14px;font-weight:700;margin-bottom:6px">${esc(s.vehicles)}</div>
               <table role="presentation" cellpadding="0" cellspacing="0">${vehiclesHtml}</table>
             </div>`
          : ""
      }
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #eee">
      <p style="color:${MUTED};font-size:12px;line-height:1.5;margin:0">${esc(s.footer)}</p>
    </td></tr>
  </table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:${MUTED};font-size:13px;width:120px">${esc(label)}</td>
    <td style="padding:8px 0;color:${INK};font-size:14px;font-weight:600">${value}</td>
  </tr>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildText(r: ReservationEmailData, lang: Lang): string {
  const s = STR[lang];
  const lines = [
    s.hello(r.guest_name),
    "",
    s.intro,
    "",
    r.villa?.name ? `${s.villa}: ${r.villa.name}` : "",
    `${s.checkIn}: ${fmt(r.check_in, lang)}`,
    `${s.checkOut}: ${fmt(r.check_out, lang)}`,
    "",
    r.pin_code ? `${s.pin}: ${r.pin_code}` : s.noPin,
  ];
  const vehicles = (r.vehicles ?? []).filter((v) => v.license_plate);
  if (vehicles.length) {
    lines.push("", `${s.vehicles}: ${vehicles.map((v) => v.license_plate).join(", ")}`);
  }
  lines.push("", s.footer);
  return lines.filter((l) => l !== undefined).join("\n");
}

export async function sendReservationEmail(
  r: ReservationEmailData,
  lang: Lang = "bg",
): Promise<void> {
  if (!r.guest_email) {
    throw new Error("Reservation has no guest email.");
  }
  const transport = getTransport();
  const s = STR[lang];

  // QR encodes the PIN so the guest can scan to read it back.
  let qrBuffer: Buffer | null = null;
  if (r.pin_code) {
    try {
      qrBuffer = await QRCode.toBuffer(r.pin_code, { width: 320, margin: 1 });
    } catch (e) {
      log.warn({ err: e }, "QR generation failed; sending email without QR");
    }
  }

  const fromAddr = env("SMTP_FROM")!;
  const fromName = env("SMTP_FROM_NAME") ?? "Villa Access";

  await transport.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to: r.guest_email,
    subject: s.subject(r.villa?.name ?? ""),
    text: buildText(r, lang),
    html: buildHtml(r, lang, Boolean(qrBuffer)),
    ...(qrBuffer
      ? { attachments: [{ filename: "access-qr.png", content: qrBuffer, cid: "reservation-qr" }] }
      : {}),
  });

  log.info({ reservation_id: r.id }, "Reservation email sent");
}
