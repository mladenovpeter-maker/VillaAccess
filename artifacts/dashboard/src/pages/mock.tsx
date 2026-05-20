import { useState, useEffect } from "react";
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
} from "lucide-react";
import { tokenStore } from "@/lib/api";

// ─── API helpers ───────────────────────────────────────────────────────────────

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

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? "bg-amber-500/15" : "bg-muted"}`}>
            <Icon className={`w-4 h-4 ${accent ?? "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VehiclePool({ data }: { data: MockVehicles }) {
  const [open, setOpen] = useState(false);
  const all = [
    ...data.real.map((v) => ({ ...v, source: "real" as const })),
    ...data.mock_pool.map((v) => ({ ...v, id: v.id as any, source: "mock" as const })),
  ];
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setOpen(!open)}
        >
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
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {all.map((v, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-xs">
                <span className="font-mono font-bold text-foreground">{v.license_plate}</span>
                <span className="text-muted-foreground">{v.make} {v.model}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    v.source === "real"
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  }`}
                >
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

  // Local draft config (before submit)
  const [draft, setDraft] = useState<Partial<SimConfig>>({});
  const [snapshotPreview, setSnapshotPreview] = useState<string | null>(null);
  const [lastTrigger, setLastTrigger] = useState<{ plate: string; confidence: number; camera: string } | null>(null);

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

  const startMut = useMutation({
    mutationFn: () => apiFetch("/start", { method: "POST", body: JSON.stringify(effectiveConfig) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["mock-status"] }); toast({ title: "Simulator started" }); setDraft({}); },
    onError: (e: any) => toast({ title: "Start failed", description: e.message, variant: "destructive" }),
  });

  const stopMut = useMutation({
    mutationFn: () => apiFetch("/stop", { method: "POST", body: "{}" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["mock-status"] }); toast({ title: "Simulator stopped" }); },
  });

  const triggerMut = useMutation({
    mutationFn: (params: object) => apiFetch("/trigger", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["mock-status"] });
      setLastTrigger({ plate: d.plate, confidence: d.confidence, camera: d.camera });
      if (d.snapshot_url) setSnapshotPreview(d.snapshot_url);
      toast({ title: "Detection triggered", description: `${d.plate} — ${d.confidence}% conf` });
    },
    onError: (e: any) => toast({ title: "Trigger failed", description: e.message, variant: "destructive" }),
  });

  const ocrMut = useMutation({
    mutationFn: () => apiFetch("/ocr", { method: "POST", body: "{}" }),
    onSuccess: (d) => {
      toast({ title: "OCR scan simulated", description: `${d.corrected_plate ?? d.plate} — ${d.confidence}%` });
    },
  });

  const gateMut = useMutation({
    mutationFn: () => {
      const villa_id = vehicles?.real[0] ? undefined : undefined;
      return apiFetch("/gate", { method: "POST", body: JSON.stringify({ villa_id: "demo" }) });
    },
    onSuccess: () => toast({ title: "Gate open simulated" }),
    onError: (e: any) => toast({ title: "Gate simulation failed", description: e.message, variant: "destructive" }),
  });

  const running = status?.running ?? false;
  const intervalSec = Math.round((draft.interval_ms ?? status?.config.interval_ms ?? 8000) / 1000);

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString();
  }

  function fmtUptime() {
    if (!status?.started_at || !running) return "—";
    const secs = Math.floor((Date.now() - new Date(status.started_at).getTime()) / 1000);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
    return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
  }

  const [uptime, setUptime] = useState(fmtUptime());
  useEffect(() => {
    const t = setInterval(() => setUptime(fmtUptime()), 1000);
    return () => clearInterval(t);
  });

  // Preview snapshot URL (with cache-buster)
  const previewUrl = snapshotPreview
    ? `${BASE}${snapshotPreview}?t=${Date.now()}`
    : `${BASE}/api/mock/snapshot?plate=DK+1234+ABC&camera=CAM-01+Preview&confidence=91.3`;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">Mock Camera Mode</h1>
                <Badge className={running
                  ? "bg-green-500/20 text-green-400 border-green-500/30 border"
                  : "bg-amber-500/20 text-amber-400 border-amber-500/30 border"
                }>
                  {running ? "● RUNNING" : "○ STOPPED"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Simulate vehicle detections, OCR, and gate events without real hardware
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {running ? (
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => stopMut.mutate()}
                disabled={stopMut.isPending}
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Simulator
              </Button>
            ) : (
              <Button
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
              >
                <Play className="w-4 h-4 mr-2" />
                Start Simulator
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Status"
            value={running ? "Running" : "Stopped"}
            icon={Activity}
            accent={running ? "text-green-400" : undefined}
          />
          <StatCard
            label="Events Fired"
            value={status?.events_fired ?? 0}
            sub={`Last: ${fmtTime(status?.last_event_at ?? null)}`}
            icon={Zap}
            accent={running ? "text-amber-400" : undefined}
          />
          <StatCard
            label="Interval"
            value={`${intervalSec}s`}
            sub="between detections"
            icon={Clock}
          />
          <StatCard
            label="Uptime"
            value={uptime}
            sub={status?.started_at ? `since ${fmtTime(status.started_at)}` : "not started"}
            icon={RefreshCw}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Config card */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                Simulator Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Interval */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Detection interval</Label>
                  <span className="text-sm font-mono text-amber-400 font-bold">{intervalSec}s</span>
                </div>
                <Slider
                  min={1} max={60} step={1}
                  value={[intervalSec]}
                  onValueChange={([v]) => setDraft((d) => ({ ...d, interval_ms: v * 1000 }))}
                  className="[&_[role=slider]]:bg-amber-500"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1s (stress test)</span>
                  <span>60s (relaxed)</span>
                </div>
              </div>

              {/* OCR error rate */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">OCR error rate</Label>
                  <span className="text-sm font-mono text-foreground">
                    {Math.round((draft.error_rate ?? status?.config.error_rate ?? 0.05) * 100)}%
                  </span>
                </div>
                <Slider
                  min={0} max={50} step={1}
                  value={[Math.round((draft.error_rate ?? status?.config.error_rate ?? 0.05) * 100)]}
                  onValueChange={([v]) => setDraft((d) => ({ ...d, error_rate: v / 100 }))}
                />
                <p className="text-[10px] text-muted-foreground">Simulates OCR misreads (0 = perfect, 50 = very noisy)</p>
              </div>

              {/* Detection mode */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">Detection mode</Label>
                <Select
                  value={draft.detection_mode ?? status?.config.detection_mode ?? "all"}
                  onValueChange={(v) => setDraft((d) => ({ ...d, detection_mode: v as any }))}
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All vehicles</SelectItem>
                    <SelectItem value="known">Known only</SelectItem>
                    <SelectItem value="unknown">Unknown only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Toggles */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Auto-open gate</Label>
                    <p className="text-[11px] text-muted-foreground">Open gate on every detection</p>
                  </div>
                  <Switch
                    checked={draft.auto_open_gate ?? status?.config.auto_open_gate ?? true}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, auto_open_gate: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Include unknown plates</Label>
                    <p className="text-[11px] text-muted-foreground">~25% of detections are unregistered</p>
                  </div>
                  <Switch
                    checked={draft.include_unknown ?? status?.config.include_unknown ?? true}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, include_unknown: v }))}
                  />
                </div>
              </div>

              {/* Apply / restart button */}
              {Object.keys(draft).length > 0 && (
                <Button
                  size="sm"
                  className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  onClick={() => startMut.mutate()}
                  disabled={startMut.isPending}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  {running ? "Restart with new config" : "Start with this config"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Manual triggers + snapshot preview */}
          <div className="space-y-4">

            {/* Manual triggers */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  Manual Triggers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">

                <Button
                  className="w-full justify-start bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30"
                  variant="outline"
                  onClick={() => triggerMut.mutate({})}
                  disabled={triggerMut.isPending}
                >
                  <Car className="w-4 h-4 mr-3" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Trigger Detection</div>
                    <div className="text-xs text-muted-foreground">Simulate a vehicle entering</div>
                  </div>
                </Button>

                <Button
                  className="w-full justify-start bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  variant="outline"
                  onClick={() => ocrMut.mutate()}
                  disabled={ocrMut.isPending}
                >
                  <ScanLine className="w-4 h-4 mr-3" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Simulate OCR Scan</div>
                    <div className="text-xs text-muted-foreground">Emit OCR result event only</div>
                  </div>
                </Button>

                <Button
                  className="w-full justify-start bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  variant="outline"
                  onClick={() => gateMut.mutate()}
                  disabled={gateMut.isPending}
                >
                  <DoorOpen className="w-4 h-4 mr-3" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Simulate Gate Open</div>
                    <div className="text-xs text-muted-foreground">Emit gate.opened domain event</div>
                  </div>
                </Button>

                {lastTrigger && (
                  <div className="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs space-y-0.5">
                    <div className="font-mono font-bold text-green-400">{lastTrigger.plate}</div>
                    <div className="text-muted-foreground">{lastTrigger.camera} · {lastTrigger.confidence}% confidence</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Snapshot preview */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    Snapshot Preview
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSnapshotPreview(null)}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md overflow-hidden border border-border bg-black">
                  <img
                    key={snapshotPreview ?? "default"}
                    src={previewUrl}
                    alt="Mock camera snapshot"
                    className="w-full object-cover"
                    style={{ imageRendering: "auto" }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 text-center">
                  {snapshotPreview ? "Last triggered detection snapshot" : "Default preview — trigger a detection to update"}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Vehicle pool */}
        {vehicles && <VehiclePool data={vehicles} />}

        {/* Dev info */}
        <Card className="bg-card border-border border-dashed">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <FlaskConical className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-amber-400">Development mode only</p>
                <p>Events are written to the real database and will appear in Logs, Event Stream, and Cameras pages. Access events created here count toward vehicle visit statistics.</p>
                <p>Snapshot SVGs are saved to <code className="bg-muted px-1 rounded">uploads/mock/</code> and served at <code className="bg-muted px-1 rounded">/api/uploads/mock/</code></p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
