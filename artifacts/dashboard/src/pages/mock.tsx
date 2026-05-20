import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, Zap, DoorOpen, ScanLine, RefreshCw,
  Car, Camera, Activity, Clock, FlaskConical, ChevronDown,
  ShieldX, CloudRain, Gauge,
} from "lucide-react";
import { tokenStore } from "@/lib/api";

// ─── API ───────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = tokenStore.getAccess();
  const r = await fetch(`${BASE}/api/mock${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SimConfig {
  interval_ms: number;
  auto_open_gate: boolean;
  include_unknown: boolean;
  error_rate: number;
  detection_mode: "all" | "known" | "unknown";
}

interface SimStatus {
  running: boolean;
  events_fired: number;
  last_event_at: string | null;
  started_at: string | null;
  config: SimConfig;
}

interface MockVehicles {
  real: { id: string; license_plate: string; make: string; model: string; status: string }[];
  mock_pool: { id: null; license_plate: string; make: string; model: string; status: string }[];
  total_real: number;
}

type ScenarioId = "detect" | "ocr" | "gate" | "deny" | "dirty" | "custom";
type DenyReason = "random" | "blacklisted" | "unregistered" | "no_reservation" | "outside_window";

interface ScenarioResult {
  scenario: ScenarioId;
  label: string;
  plate?: string;
  garbled_plate?: string;
  confidence?: number;
  reason?: string;
  snapshot_url?: string;
  status: "allowed" | "denied" | "pending" | "event_only";
  ts: string;
}

// ─── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS: {
  id: ScenarioId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;        // tailwind colour key
  badge: string;
  badgeColor: string;
}[] = [
  {
    id: "detect",
    label: "Vehicle Detection",
    desc: "Normal entry — writes access event, auto-opens gate",
    icon: Car,
    color: "green",
    badge: "ENTRY / ALLOWED",
    badgeColor: "text-green-400 bg-green-500/10 border-green-500/30",
  },
  {
    id: "ocr",
    label: "OCR Plate Scan",
    desc: "Emits OCR result domain event only — no access record written",
    icon: ScanLine,
    color: "blue",
    badge: "EVENT ONLY",
    badgeColor: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  },
  {
    id: "gate",
    label: "Gate Open",
    desc: "Fires gate.opened domain event — tests downstream gate listeners",
    icon: DoorOpen,
    color: "amber",
    badge: "GATE EVENT",
    badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  {
    id: "deny",
    label: "Denied Access",
    desc: "Blacklisted, unregistered, or outside reservation window",
    icon: ShieldX,
    color: "red",
    badge: "DENIED",
    badgeColor: "text-red-400 bg-red-500/10 border-red-500/30",
  },
  {
    id: "dirty",
    label: "Dirty Plate",
    desc: "10–40% confidence, garbled OCR — triggers pending / manual review",
    icon: CloudRain,
    color: "orange",
    badge: "PENDING / LOW CONF",
    badgeColor: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  },
  {
    id: "custom",
    label: "Custom Confidence",
    desc: "Vehicle detection with exact confidence from slider",
    icon: Gauge,
    color: "purple",
    badge: "MANUAL",
    badgeColor: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  },
];

const COLOR_RING: Record<string, string> = {
  green:  "border-green-500/40 bg-green-500/5 hover:bg-green-500/10",
  blue:   "border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10",
  amber:  "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
  red:    "border-red-500/40 bg-red-500/5 hover:bg-red-500/10",
  orange: "border-orange-500/40 bg-orange-500/5 hover:bg-orange-500/10",
  purple: "border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10",
};

const ICON_COLOR: Record<string, string> = {
  green: "text-green-400",  blue: "text-blue-400",   amber: "text-amber-400",
  red:   "text-red-400",    orange: "text-orange-400", purple: "text-purple-400",
};

const BTN_COLOR: Record<string, string> = {
  green:  "bg-green-500/20 hover:bg-green-500/30 text-green-300 border-green-500/40",
  blue:   "bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border-blue-500/40",
  amber:  "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40",
  red:    "bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/40",
  orange: "bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border-orange-500/40",
  purple: "bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-500/40",
};

// ─── Small helpers ──────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

function confBadge(c: number) {
  if (c >= 80) return "text-green-400";
  if (c >= 50) return "text-amber-400";
  return "text-red-400";
}

// ─── ResultFeed ────────────────────────────────────────────────────────────────

function ResultFeed({ results }: { results: ScenarioResult[] }) {
  const STATUS_STYLE: Record<string, string> = {
    allowed:    "bg-green-500/15 text-green-400 border-green-500/30",
    denied:     "bg-red-500/15 text-red-400 border-red-500/30",
    pending:    "bg-orange-500/15 text-orange-400 border-orange-500/30",
    event_only: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  };

  if (results.length === 0) return (
    <div className="text-center py-6 text-muted-foreground text-xs">
      No scenarios fired yet — click any Fire button above
    </div>
  );

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {[...results].reverse().map((r, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-muted/40 border border-border/50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-foreground">{r.label}</span>
              <Badge variant="outline" className={`text-[10px] border ${STATUS_STYLE[r.status]}`}>
                {r.status.replace("_", " ").toUpperCase()}
              </Badge>
            </div>
            {r.garbled_plate ? (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-xs text-orange-400 font-bold">{r.garbled_plate}</span>
                <span className="text-[10px] text-muted-foreground line-through">{r.plate}</span>
              </div>
            ) : r.plate ? (
              <span className="font-mono text-xs text-foreground font-bold">{r.plate}</span>
            ) : null}
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
              {r.confidence !== undefined && (
                <span className={confBadge(r.confidence)}>{r.confidence.toFixed(1)}% conf</span>
              )}
              {r.reason && <span>reason: {r.reason.replace(/_/g, " ")}</span>}
              <span>{fmtTime(r.ts)}</span>
            </div>
          </div>
          {r.snapshot_url && (
            <a href={`${BASE}${r.snapshot_url}`} target="_blank" rel="noreferrer">
              <img
                src={`${BASE}${r.snapshot_url}`}
                className="w-14 h-10 object-cover rounded border border-border shrink-0 hover:opacity-80 transition-opacity"
                alt="snapshot"
              />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── VehiclePool ───────────────────────────────────────────────────────────────

function VehiclePool({ data }: { data: MockVehicles }) {
  const [open, setOpen] = useState(false);
  const all = [
    ...data.real.map((v) => ({ ...v, source: "real" as const })),
    ...data.mock_pool.map((v) => ({ ...v, id: v.id as any, source: "mock" as const })),
  ];
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <button className="flex items-center justify-between w-full text-left" onClick={() => setOpen(!open)}>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Car className="w-4 h-4 text-muted-foreground" />
            Vehicle Pool
            <Badge variant="outline" className="text-xs">{all.length}</Badge>
            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">
              {data.total_real} real
            </Badge>
          </CardTitle>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {all.map((v, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-xs">
                <span className="font-mono font-bold">{v.license_plate}</span>
                <span className="text-muted-foreground">{v.make} {v.model}</span>
                <Badge variant="outline" className={`text-[10px] ${v.source === "real"
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                  {v.source === "real" ? v.status : "pool"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function MockPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Partial<SimConfig>>({});
  const [customConf, setCustomConf] = useState(88);
  const [denyReason, setDenyReason] = useState<DenyReason>("random");
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [firing, setFiring] = useState<ScenarioId | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: status, isLoading } = useQuery<SimStatus>({
    queryKey: ["mock-status"],
    queryFn: () => apiFetch("/status"),
    refetchInterval: 3000,
  });

  const { data: vehicles } = useQuery<MockVehicles>({
    queryKey: ["mock-vehicles"],
    queryFn: () => apiFetch("/vehicles"),
  });

  const effectiveConfig = { ...(status?.config ?? {}), ...draft } as SimConfig;
  const running = status?.running ?? false;
  const intervalSec = Math.round((draft.interval_ms ?? status?.config.interval_ms ?? 8000) / 1000);

  // ── Start / Stop ──────────────────────────────────────────────────────────────

  const startMut = useMutation({
    mutationFn: () => apiFetch("/start", { method: "POST", body: JSON.stringify(effectiveConfig) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["mock-status"] }); setDraft({}); toast({ title: "Simulator started" }); },
    onError: (e: any) => toast({ title: "Start failed", description: e.message, variant: "destructive" }),
  });

  const stopMut = useMutation({
    mutationFn: () => apiFetch("/stop", { method: "POST", body: "{}" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["mock-status"] }); toast({ title: "Simulator stopped" }); },
  });

  // ── Fire a scenario ────────────────────────────────────────────────────────────

  async function fire(id: ScenarioId) {
    setFiring(id);
    try {
      let data: any;
      switch (id) {
        case "detect":
          data = await apiFetch("/trigger", { method: "POST", body: "{}" });
          pushResult({ scenario: id, label: "Vehicle Detection", plate: data.plate, confidence: data.confidence, snapshot_url: data.snapshot_url, status: "allowed" });
          break;
        case "ocr":
          data = await apiFetch("/ocr", { method: "POST", body: "{}" });
          pushResult({ scenario: id, label: "OCR Plate Scan", plate: data.plate, confidence: data.confidence, status: "event_only" });
          break;
        case "gate":
          data = await apiFetch("/gate", { method: "POST", body: JSON.stringify({}) });
          pushResult({ scenario: id, label: "Gate Open", status: "event_only" });
          break;
        case "deny": {
          const body = denyReason === "random" ? {} : { reason: denyReason };
          data = await apiFetch("/deny", { method: "POST", body: JSON.stringify(body) });
          pushResult({ scenario: id, label: "Denied Access", plate: data.plate, confidence: data.confidence, reason: data.reason, snapshot_url: data.snapshot_url, status: "denied" });
          break;
        }
        case "dirty":
          data = await apiFetch("/dirty", { method: "POST", body: "{}" });
          pushResult({ scenario: id, label: "Dirty Plate", plate: data.real_plate, garbled_plate: data.garbled_plate, confidence: data.confidence, snapshot_url: data.snapshot_url, status: "pending" });
          break;
        case "custom":
          data = await apiFetch("/trigger", { method: "POST", body: JSON.stringify({ confidence: customConf }) });
          pushResult({ scenario: id, label: "Custom Confidence", plate: data.plate, confidence: data.confidence, snapshot_url: data.snapshot_url, status: "allowed" });
          break;
      }
      void qc.invalidateQueries({ queryKey: ["mock-status"] });
      toast({ title: `${SCENARIOS.find(s => s.id === id)?.label} fired` });
    } catch (err: any) {
      toast({ title: "Scenario failed", description: err.message, variant: "destructive" });
    } finally {
      setFiring(null);
    }
  }

  function pushResult(r: Omit<ScenarioResult, "ts">) {
    setResults((prev) => [...prev.slice(-49), { ...r, ts: new Date().toISOString() }]);
  }

  // Uptime counter
  const [uptime, setUptime] = useState("—");
  useEffect(() => {
    const tick = () => {
      if (!status?.started_at || !running) { setUptime("—"); return; }
      const s = Math.floor((Date.now() - new Date(status.started_at).getTime()) / 1000);
      setUptime(s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m ${s%60}s` : `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [status?.started_at, running]);

  if (isLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Mock Camera Mode</h1>
                <Badge className={running
                  ? "bg-green-500/20 text-green-400 border-green-500/30 border"
                  : "bg-amber-500/20 text-amber-400 border-amber-500/30 border"}>
                  {running ? "● RUNNING" : "○ STOPPED"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Simulate the full camera event pipeline without real hardware
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {running ? (
              <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => stopMut.mutate()} disabled={stopMut.isPending}>
                <Square className="w-4 h-4 mr-2" />Stop Simulator
              </Button>
            ) : (
              <Button className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                <Play className="w-4 h-4 mr-2" />Start Simulator
              </Button>
            )}
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Status",       val: running ? "Running" : "Stopped", sub: "",                               icon: Activity, accent: running ? "text-green-400" : undefined },
            { label: "Events Fired", val: status?.events_fired ?? 0,       sub: `Last: ${fmtTime(status?.last_event_at ?? null)}`, icon: Zap, accent: "text-amber-400" },
            { label: "Interval",     val: `${intervalSec}s`,               sub: "between auto detections",         icon: Clock,    accent: undefined },
            { label: "Uptime",       val: uptime,                          sub: status?.started_at ? `since ${fmtTime(status.started_at)}` : "not started", icon: RefreshCw, accent: undefined },
          ].map(({ label, val, sub, icon: Icon, accent }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</p>
                    <p className={`text-2xl font-bold mt-1 ${accent ?? "text-foreground"}`}>{val}</p>
                    {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                  </div>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent ? "bg-amber-500/10" : "bg-muted"}`}>
                    <Icon className={`w-4 h-4 ${accent ?? "text-muted-foreground"}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* ── Config card (left) ── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                Auto-Simulator Config
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-sm">Detection interval</Label>
                  <span className="text-sm font-mono text-amber-400 font-bold">{intervalSec}s</span></div>
                <Slider min={1} max={60} step={1} value={[intervalSec]}
                  onValueChange={([v]) => setDraft((d) => ({ ...d, interval_ms: v * 1000 }))}
                  className="[&_[role=slider]]:bg-amber-500" />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1s (stress)</span><span>60s (relaxed)</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-sm">OCR error rate</Label>
                  <span className="text-sm font-mono">{Math.round((draft.error_rate ?? status?.config.error_rate ?? 0.05) * 100)}%</span></div>
                <Slider min={0} max={50} step={1}
                  value={[Math.round((draft.error_rate ?? status?.config.error_rate ?? 0.05) * 100)]}
                  onValueChange={([v]) => setDraft((d) => ({ ...d, error_rate: v / 100 }))} />
                <p className="text-[10px] text-muted-foreground">Probability of a misread character per detection</p>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Detection mode</Label>
                <Select value={draft.detection_mode ?? status?.config.detection_mode ?? "all"}
                  onValueChange={(v) => setDraft((d) => ({ ...d, detection_mode: v as any }))}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All vehicles</SelectItem>
                    <SelectItem value="known">Known only</SelectItem>
                    <SelectItem value="unknown">Unknown only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3 pt-1 border-t border-border">
                <div className="flex items-center justify-between pt-3">
                  <div>
                    <Label className="text-sm">Auto-open gate</Label>
                    <p className="text-[11px] text-muted-foreground">Open gate on every detection</p>
                  </div>
                  <Switch checked={draft.auto_open_gate ?? status?.config.auto_open_gate ?? true}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, auto_open_gate: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Include unknown plates</Label>
                    <p className="text-[11px] text-muted-foreground">~25% of detections unregistered</p>
                  </div>
                  <Switch checked={draft.include_unknown ?? status?.config.include_unknown ?? true}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, include_unknown: v }))} />
                </div>
              </div>

              {Object.keys(draft).length > 0 && (
                <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  {running ? "Restart with new config" : "Start with this config"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Scenario Simulator (right) ── */}
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  Scenario Simulator
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    — feeds the same event pipeline as real cameras
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">

                {/* Custom confidence slider (shared by Detect + Custom) */}
                <div className="flex items-center gap-3 px-1 pb-3 border-b border-border/60">
                  <Label className="text-xs text-muted-foreground shrink-0">Confidence override</Label>
                  <Slider min={0} max={100} step={1} value={[customConf]}
                    onValueChange={([v]) => setCustomConf(v)}
                    className="flex-1 [&_[role=slider]]:bg-purple-500" />
                  <span className={`text-sm font-mono font-bold w-12 text-right ${confBadge(customConf)}`}>
                    {customConf}%
                  </span>
                </div>

                {/* Deny reason selector (shown inline with deny card) */}
                {/* 6 scenario cards */}
                <div className="grid grid-cols-1 gap-2">
                  {SCENARIOS.map((s) => (
                    <div key={s.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${COLOR_RING[s.color]}`}>
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-${s.color}-500/10`}>
                        <s.icon className={`w-4 h-4 ${ICON_COLOR[s.color]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{s.label}</span>
                          <Badge variant="outline" className={`text-[10px] border ${s.badgeColor}`}>{s.badge}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{s.desc}</p>
                        {/* Deny reason selector inline */}
                        {s.id === "deny" && (
                          <Select value={denyReason} onValueChange={(v) => setDenyReason(v as DenyReason)}>
                            <SelectTrigger className="h-6 text-[11px] mt-1.5 w-44 border-red-500/30 bg-red-500/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="random">Random reason</SelectItem>
                              <SelectItem value="blacklisted">Blacklisted vehicle</SelectItem>
                              <SelectItem value="unregistered">Unregistered plate</SelectItem>
                              <SelectItem value="no_reservation">No active reservation</SelectItem>
                              <SelectItem value="outside_window">Outside check-in window</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {/* Custom confidence indicator */}
                        {s.id === "custom" && (
                          <span className={`text-[11px] font-mono font-bold ${confBadge(customConf)}`}>
                            Will fire at {customConf}% confidence
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`shrink-0 h-7 px-3 text-xs font-semibold border ${BTN_COLOR[s.color]}`}
                        onClick={() => fire(s.id)}
                        disabled={firing !== null}
                      >
                        {firing === s.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          "Fire"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ── Result feed ── */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    Simulation Results
                  </span>
                  {results.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => setResults([])}>
                      Clear
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResultFeed results={results} />
                <div ref={bottomRef} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Vehicle pool ── */}
        {vehicles && <VehiclePool data={vehicles} />}

        {/* ── Dev info ── */}
        <Card className="bg-card border-border border-dashed">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <FlaskConical className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-amber-400">Event Pipeline</p>
                <p>
                  Every scenario writes real records to the same tables real cameras use:
                  <code className="bg-muted px-1 rounded ml-1">access_events</code> +
                  <code className="bg-muted px-1 rounded ml-1">domain_events</code>.
                  Results appear in <strong className="text-foreground">Logs</strong>,{" "}
                  <strong className="text-foreground">Event Stream</strong>, and{" "}
                  <strong className="text-foreground">Cameras</strong> pages.
                  Snapshots → <code className="bg-muted px-1 rounded">uploads/mock/</code>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
