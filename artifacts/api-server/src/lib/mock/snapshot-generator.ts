import * as path from "path";
import { promises as fs } from "fs";
import { uploadsUrl } from "../public-url";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const MOCK_DIR = path.join(UPLOADS_ROOT, "mock");

export interface SnapshotOpts {
  plate: string;
  cameraName: string;
  villaName?: string;
  confidence: number;
  detected: boolean;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

function ts(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const CAR_COLORS = ["#455a64","#37474f","#546e7a","#607d8b","#263238","#3e4d57"];
const DETECTION_COLOR = "#00e676";
const WARN_COLOR = "#ff9800";

function pickColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return CAR_COLORS[h % CAR_COLORS.length];
}

export function generateSvg(opts: SnapshotOpts): string {
  const { plate, cameraName, villaName = "", confidence, detected } = opts;
  const carColor = pickColor(plate);
  const dc = detected ? DETECTION_COLOR : WARN_COLOR;
  const confColor = confidence >= 85 ? DETECTION_COLOR : confidence >= 65 ? WARN_COLOR : "#f44336";

  // Randomise car X position a bit for visual variety
  const seed = plate.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const carX = 160 + (seed % 80);
  const carY = 200;

  // Detection box
  const bbX = carX - 18; const bbY = carY + 5;
  const bbW = 236;       const bbH = 145;

  // Plate box inside bounding box
  const plX = carX + 30; const plY = carY + 110;
  const plW = 134;        const plH = 32;

  const scanlines = Array.from({ length: 96 }, (_, i) =>
    `<rect x="0" y="${i * 5 + 1}" width="640" height="2" fill="#000" opacity="0.03"/>`
  ).join("");

  return `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#0d1117"/>
    <stop offset="60%" stop-color="#161b22"/>
    <stop offset="100%" stop-color="#21262d"/>
  </linearGradient>
  <linearGradient id="topbar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000" stop-opacity="0.88"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="botbar" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0%" stop-color="#000" stop-opacity="0.88"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0"/>
  </linearGradient>
</defs>

<!-- Background -->
<rect width="640" height="480" fill="url(#bg)"/>

<!-- Road surface -->
<rect x="0" y="360" width="640" height="120" fill="#111418" opacity="0.6"/>
<line x1="320" y1="480" x2="190" y2="360" stroke="#fff" stroke-width="1" stroke-dasharray="14,18" opacity="0.07"/>
<line x1="320" y1="480" x2="450" y2="360" stroke="#fff" stroke-width="1" stroke-dasharray="14,18" opacity="0.07"/>

<!-- Vehicle shadow -->
<ellipse cx="${carX + 100}" cy="${carY + 165}" rx="108" ry="12" fill="#000" opacity="0.5"/>

<!-- Car body -->
<rect x="${carX}" y="${carY + 48}" width="200" height="80" rx="9" fill="${carColor}"/>
<!-- Cabin -->
<rect x="${carX + 32}" y="${carY + 14}" width="136" height="52" rx="7" fill="${lighten(carColor)}"/>
<!-- Windshield -->
<rect x="${carX + 40}" y="${carY + 19}" width="50" height="38" rx="4" fill="#102040" opacity="0.92"/>
<!-- Rear window -->
<rect x="${carX + 110}" y="${carY + 19}" width="50" height="38" rx="4" fill="#102040" opacity="0.92"/>
<!-- Body details -->
<rect x="${carX}" y="${carY + 75}" width="200" height="4" fill="#000" opacity="0.25"/>
<!-- Front lamp -->
<rect x="${carX}" y="${carY + 57}" width="14" height="20" rx="3" fill="#fff9c4" opacity="0.85"/>
<rect x="${carX}" y="${carY + 57}" width="6" height="20" rx="2" fill="#fff" opacity="0.5"/>
<!-- Rear lamp -->
<rect x="${carX + 186}" y="${carY + 57}" width="14" height="20" rx="3" fill="#f44336" opacity="0.8"/>
<!-- Door line -->
<line x1="${carX + 100}" y1="${carY + 48}" x2="${carX + 100}" y2="${carY + 128}" stroke="#000" stroke-width="1.5" opacity="0.35"/>
<!-- Wheels -->
<circle cx="${carX + 44}" cy="${carY + 128}" r="25" fill="#1a1a1a" stroke="#2d2d2d" stroke-width="2"/>
<circle cx="${carX + 44}" cy="${carY + 128}" r="14" fill="#2a2a2a" stroke="#3d3d3d" stroke-width="1"/>
<circle cx="${carX + 44}" cy="${carY + 128}" r="5" fill="#444"/>
<circle cx="${carX + 156}" cy="${carY + 128}" r="25" fill="#1a1a1a" stroke="#2d2d2d" stroke-width="2"/>
<circle cx="${carX + 156}" cy="${carY + 128}" r="14" fill="#2a2a2a" stroke="#3d3d3d" stroke-width="1"/>
<circle cx="${carX + 156}" cy="${carY + 128}" r="5" fill="#444"/>

${detected ? `<!-- Detection bounding box -->
<rect x="${bbX}" y="${bbY}" width="${bbW}" height="${bbH}" fill="none" stroke="${dc}" stroke-width="1.8" stroke-dasharray="7,5" opacity="0.8"/>
<!-- Corner accents -->
<polyline points="${bbX},${bbY+14} ${bbX},${bbY} ${bbX+14},${bbY}" fill="none" stroke="${dc}" stroke-width="3"/>
<polyline points="${bbX+bbW-14},${bbY} ${bbX+bbW},${bbY} ${bbX+bbW},${bbY+14}" fill="none" stroke="${dc}" stroke-width="3"/>
<polyline points="${bbX},${bbY+bbH-14} ${bbX},${bbY+bbH} ${bbX+14},${bbY+bbH}" fill="none" stroke="${dc}" stroke-width="3"/>
<polyline points="${bbX+bbW-14},${bbY+bbH} ${bbX+bbW},${bbY+bbH} ${bbX+bbW},${bbY+bbH-14}" fill="none" stroke="${dc}" stroke-width="3"/>
<!-- Plate highlight -->
<rect x="${plX}" y="${plY}" width="${plW}" height="${plH}" fill="${dc}" opacity="0.12" rx="3"/>
<rect x="${plX}" y="${plY}" width="${plW}" height="${plH}" fill="none" stroke="${dc}" stroke-width="1.5" rx="3"/>
<!-- Plate OCR label -->
<rect x="${plX}" y="${plY - 20}" width="${plate.length * 9 + 12}" height="18" fill="${dc}" rx="3" opacity="0.92"/>
<text x="${plX + 6}" y="${plY - 6}" font-family="Courier New,monospace" font-size="11" fill="#000" font-weight="bold">${plate}</text>` : ""}

<!-- Top bar -->
<rect width="640" height="52" fill="url(#topbar)"/>
<text x="11" y="22" font-family="Courier New,monospace" font-size="13" fill="white" font-weight="bold" opacity="0.95">${cameraName.toUpperCase()}</text>
${villaName ? `<text x="11" y="40" font-family="Courier New,monospace" font-size="10" fill="#aaa" opacity="0.75">${villaName}</text>` : ""}
<text x="629" y="22" font-family="Courier New,monospace" font-size="11" fill="white" text-anchor="end" opacity="0.85">${ts()}</text>
<!-- REC blink -->
<circle cx="621" cy="38" r="5" fill="#f44336" opacity="0.9">
  <animate attributeName="opacity" values="0.9;0.25;0.9" dur="1.6s" repeatCount="indefinite"/>
</circle>
<text x="609" y="42" font-family="Courier New,monospace" font-size="11" fill="#f55" text-anchor="end" font-weight="bold">REC</text>

<!-- Bottom bar -->
<rect y="436" width="640" height="44" fill="url(#botbar)"/>
${detected ? `<rect x="10" y="455" width="${Math.round(confidence * 1.8)}" height="7" rx="3" fill="${confColor}" opacity="0.85"/>
<rect x="10" y="455" width="180" height="7" rx="3" fill="none" stroke="#444" stroke-width="1"/>
<text x="198" y="464" font-family="Courier New,monospace" font-size="11" fill="${confColor}" font-weight="bold">${confidence.toFixed(1)}% OCR</text>
<text x="629" y="464" font-family="Courier New,monospace" font-size="11" fill="${dc}" text-anchor="end" font-weight="bold">▶ VEHICLE DETECTED</text>` :
`<text x="11" y="464" font-family="Courier New,monospace" font-size="11" fill="#555">● MONITORING</text>`}

<!-- MOCK watermark -->
<text x="320" y="248" font-family="Arial,sans-serif" font-size="60" fill="white" opacity="0.035" text-anchor="middle" font-weight="900" letter-spacing="8">MOCK</text>

<!-- Scanlines -->
${scanlines}
</svg>`;
}

function lighten(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((n >> 16) & 0xFF) + 28);
  const g = Math.min(255, ((n >> 8)  & 0xFF) + 28);
  const b = Math.min(255, (n & 0xFF)         + 28);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

export async function saveMockSnapshot(opts: SnapshotOpts): Promise<string> {
  const now = new Date();
  const y  = now.getFullYear().toString();
  const m  = pad2(now.getMonth() + 1);
  const d  = pad2(now.getDate());

  const dir = path.join(MOCK_DIR, y, m, d);
  await fs.mkdir(dir, { recursive: true });

  const safe = opts.plate.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
  const filename = `mock_${Date.now()}_${safe}.svg`;
  const filepath = path.join(dir, filename);

  await fs.writeFile(filepath, generateSvg(opts), "utf-8");
  return uploadsUrl(`mock/${y}/${m}/${d}/${filename}`);
}
