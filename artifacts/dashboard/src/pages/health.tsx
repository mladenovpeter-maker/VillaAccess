import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import {
  Database, Server, Activity, Radio, Brain, Camera,
  Wifi, WifiOff, AlertCircle, CheckCircle2, Clock, Cpu, MemoryStick,
  DoorOpen, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ComponentHealth {
  status: "ok" | "error" | "not_configured" | "degraded";
  latency_ms: number | null;
  detail: string;
}

interface SystemHealth {
  checked_at: string;
  components: Record<string, ComponentHealth>;
  cameras: { total: number; online: number; offline: number; error: number };
  entrances: { total: number; active: number };
  uptime_seconds: number;
  node_version: string;
  memory_mb: number;
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
          <div className={cn("text-xs font-semibold uppercase tracking-wide shrink-0", textCls)}>
            {health.status === "not_configured" ? "N/A" : health.status.toUpperCase()}
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

            {/* Quick metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t("health.uptime"), value: formatUptime(data.uptime_seconds), icon: Clock, color: "text-green-400" },
                { label: t("health.memory"), value: `${data.memory_mb} MB`, icon: Cpu, color: "text-blue-400" },
                { label: t("health.camerasOnline"), value: `${data.cameras.online}/${data.cameras.total}`, icon: Camera, color: data.cameras.offline > 0 ? "text-amber-400" : "text-green-400" },
                { label: t("health.entrancesActive"), value: `${data.entrances.active}/${data.entrances.total}`, icon: DoorOpen, color: "text-primary" },
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
