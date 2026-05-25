import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "react-i18next";
import {
  Database, Server, Activity, Radio, Brain, Camera,
  Wifi, WifiOff, AlertCircle, CheckCircle2, Clock, Cpu, MemoryStick,
  DoorOpen, RefreshCw, HardDrive, Gauge, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ComponentHealth {
  status: "ok" | "error" | "not_configured" | "degraded";
  latency_ms: number | null;
  detail: string;
  env_enabled?: boolean;
  kill_switch_engaged?: boolean;
  has_api_key?: boolean;
}

interface HostCpu { cores: number; load_1: number; load_5: number; load_15: number; used_pct: number; source: "host" | "container" }
interface HostMem { total_bytes: number; used_bytes: number; available_bytes: number; used_pct: number; source: "host" | "container" }
interface HostDisk { label: string; total_bytes: number; used_bytes: number; free_bytes: number; used_pct: number | null }

interface SystemHealth {
  checked_at: string;
  components: Record<string, ComponentHealth>;
  cameras: { total: number; online: number; offline: number; error: number };
  smart_locks?: { total: number; online: number; offline: number; error: number; battery_low: number };
  entrances: { total: number; active: number };
  host?: {
    cpu: HostCpu;
    memory: HostMem;
    disk: HostDisk | null;
    uptime_seconds: number;
    uptime_source: "host" | "container";
  };
  database_detail?: { size_bytes: number | null; connections: number | null };
  uptime_seconds: number;
  node_version: string;
  memory_mb: number;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function pctTone(pct: number | null): { color: string; bar: string; tone: "ok" | "warn" | "crit" } {
  if (pct == null) return { color: "text-muted-foreground", bar: "bg-muted-foreground/40", tone: "ok" };
  if (pct >= 90) return { color: "text-red-400",   bar: "bg-red-400",   tone: "crit" };
  if (pct >= 75) return { color: "text-amber-400", bar: "bg-amber-400", tone: "warn" };
  return { color: "text-green-400", bar: "bg-green-400", tone: "ok" };
}

function HostMetricCard({ label, icon: Icon, primary, pct, secondary, badge }: {
  label: string;
  icon: React.ElementType;
  primary: string;
  pct: number | null;
  secondary?: string;
  badge?: string;
}) {
  const tone = pctTone(pct);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className={cn("w-4 h-4", tone.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className={cn("text-lg font-bold font-mono", tone.color)}>{primary}</div>
              {badge && <span className="text-[9px] font-mono uppercase tracking-wide text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted">{badge}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            {pct != null && (
              <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full transition-all", tone.bar)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
              </div>
            )}
            {secondary && <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono truncate">{secondary}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const COMPONENT_ICONS: Record<string, React.ElementType> = {
  database: Database,
  api: Server,
  event_bus: Activity,
  ocr_worker: Brain,
  ai_engine: Brain,
};

const COMPONENT_LABELS: Record<string, string> = {
  database: "PostgreSQL Database",
  api: "API Server",
  event_bus: "SSE Event Bus",
  ocr_worker: "OCR Worker",
  ai_engine: "AI Engine",
};

function StatusDot({ status }: { status: string }) {
  if (status === "ok") return <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]" />;
  if (status === "error") return <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />;
  if (status === "degraded") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />;
  return <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />;
}

function ComponentCard({ name, health }: { name: string; health: ComponentHealth }) {
  const Icon = COMPONENT_ICONS[name] ?? Server;
  const label = COMPONENT_LABELS[name] ?? name.replace(/_/g, " ");
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const showAiToggle =
    name === "ai_engine" && isAdmin && health.env_enabled === true && health.has_api_key === true;

  const toggleKill = useMutation({
    mutationFn: (engage: boolean) =>
      api.post("/diagnostics/ai-fallback/kill-switch", { engaged: engage }),
    onSuccess: (_d, engaged) => {
      qc.invalidateQueries({ queryKey: ["system-health"] });
      toast({
        title: engaged ? "AI fallback изключен" : "AI fallback включен",
        description: engaged
          ? "OpenAI повикванията са спрени докато не го включиш отново."
          : "AI ще се задейства след 3 неуспешни OCR опита.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Грешка",
        description: err?.message ?? "Неуспешно превключване",
        variant: "destructive",
      });
    },
  });

  const borderCls = health.status === "ok"
    ? "border-green-500/20 bg-green-500/5"
    : health.status === "not_configured"
    ? "border-border/40 bg-muted/10"
    : health.status === "error"
    ? "border-red-500/20 bg-red-500/5"
    : "border-amber-500/20 bg-amber-500/5";

  const textCls = health.status === "ok" ? "text-green-400"
    : health.status === "not_configured" ? "text-muted-foreground/50"
    : health.status === "error" ? "text-red-400"
    : "text-amber-400";

  return (
    <Card className={cn("border", borderCls)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", health.status === "ok" ? "bg-green-500/10" : "bg-muted")}>
            <Icon className={cn("w-4 h-4", textCls)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={health.status} />
              <span className="text-sm font-semibold text-foreground capitalize">{label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{health.detail}</p>
            {health.latency_ms != null && (
              <span className="text-xs font-mono text-muted-foreground">{health.latency_ms}ms</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className={cn("text-xs font-semibold uppercase tracking-wide", textCls)}>
              {health.status === "not_configured" ? "N/A" : health.status.toUpperCase()}
            </div>
            {showAiToggle && (
              <div className="flex items-center gap-1.5" title="Включи/изключи AI fallback (само админ)">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {health.kill_switch_engaged ? "OFF" : "ON"}
                </span>
                <Switch
                  checked={!health.kill_switch_engaged}
                  disabled={toggleKill.isPending}
                  onCheckedChange={(checked) => toggleKill.mutate(!checked)}
                  aria-label="AI fallback kill-switch"
                />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

export default function HealthPage() {
  const { t } = useTranslation();

  const { data, isLoading, refetch, isFetching } = useQuery<SystemHealth>({
    queryKey: ["system-health"],
    queryFn: () => api.get("/diagnostics/system"),
    refetchInterval: 15000,
  });

  const compOrder = ["database", "api", "event_bus", "ocr_worker", "ai_engine"];

  return (
    <AppLayout
      title={t("health.title")}
      subtitle={t("health.subtitle")}
      actions={
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          {t("health.refresh")}
        </Button>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6">

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : data ? (
          <>
            {/* Checked at */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {t("health.checkedAt")}: {new Date(data.checked_at).toLocaleTimeString()}
              <span className="ml-auto">Auto-refreshes every 15s</span>
            </div>

            {/* Host metrics (CPU / RAM / Disk / Uptime) */}
            {data.host && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Host
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <HostMetricCard
                    label="CPU Load"
                    icon={Gauge}
                    primary={`${data.host.cpu.used_pct}%`}
                    pct={data.host.cpu.used_pct}
                    secondary={`load ${data.host.cpu.load_1.toFixed(2)} · ${data.host.cpu.cores} cores`}
                    badge={data.host.cpu.source === "host" ? "host" : "ctr"}
                  />
                  <HostMetricCard
                    label="Memory"
                    icon={MemoryStick}
                    primary={`${data.host.memory.used_pct}%`}
                    pct={data.host.memory.used_pct}
                    secondary={`${fmtBytes(data.host.memory.used_bytes)} / ${fmtBytes(data.host.memory.total_bytes)}`}
                    badge={data.host.memory.source === "host" ? "host" : "ctr"}
                  />
                  {data.host.disk ? (
                    <HostMetricCard
                      label={`Disk (${data.host.disk.label})`}
                      icon={HardDrive}
                      primary={data.host.disk.used_pct != null ? `${data.host.disk.used_pct}%` : "—"}
                      pct={data.host.disk.used_pct}
                      secondary={`${fmtBytes(data.host.disk.free_bytes)} free`}
                    />
                  ) : (
                    <HostMetricCard label="Disk" icon={HardDrive} primary="—" pct={null} secondary="unavailable" />
                  )}
                  <HostMetricCard
                    label={data.host.uptime_source === "host" ? "Host Uptime" : "API Uptime"}
                    icon={Clock}
                    primary={formatUptime(data.host.uptime_seconds)}
                    pct={null}
                    secondary={`API ${formatUptime(data.uptime_seconds)}`}
                    badge={data.host.uptime_source === "host" ? "host" : "ctr"}
                  />
                </div>
              </div>
            )}

            {/* Operational counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t("health.uptime"), value: formatUptime(data.uptime_seconds), icon: Clock, color: "text-green-400" },
                { label: "API Heap", value: `${data.memory_mb} MB`, icon: Cpu, color: "text-blue-400" },
                { label: t("health.camerasOnline"), value: `${data.cameras.online}/${data.cameras.total}`, icon: Camera, color: data.cameras.offline > 0 ? "text-amber-400" : "text-green-400" },
                { label: t("health.entrancesActive"), value: `${data.entrances.active}/${data.entrances.total}`, icon: DoorOpen, color: "text-primary" },
                ...(data.smart_locks && data.smart_locks.total > 0 ? [{
                  label: t("nav.locks"),
                  value: `${data.smart_locks.online}/${data.smart_locks.total}`,
                  icon: Lock,
                  color:
                    data.smart_locks.error > 0 ? "text-red-400"
                    : data.smart_locks.offline > 0 || data.smart_locks.battery_low > 0 ? "text-amber-400"
                    : "text-green-400",
                }] : []),
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Icon className={cn("w-4 h-4", color)} />
                      </div>
                      <div>
                        <div className={cn("text-lg font-bold font-mono", color)}>{value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Component health */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t("health.components")}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...compOrder, ...Object.keys(data.components).filter((k) => !compOrder.includes(k))]
                  .filter((k) => data.components[k])
                  .map((name) => (
                    <ComponentCard key={name} name={name} health={data.components[name]} />
                  ))}
              </div>
            </div>

            {/* Camera breakdown */}
            {data.cameras.total > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="w-4 h-4 text-primary" />
                    {t("health.cameraStatus")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-sm"><span className="font-bold text-foreground">{data.cameras.online}</span> {t("cameras.online")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-sm"><span className="font-bold text-foreground">{data.cameras.offline}</span> {t("cameras.offline")}</span>
                    </div>
                    {data.cameras.error > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-sm"><span className="font-bold text-foreground">{data.cameras.error}</span> {t("cameras.error")}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-sm text-muted-foreground">{data.cameras.total} {t("cameras.total")}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Node info */}
            <div className="text-xs text-muted-foreground/50 text-right">
              Node.js {data.node_version}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              {t("health.unavailable")}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
