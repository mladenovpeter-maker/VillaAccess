import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Wifi, WifiOff, AlertCircle, CheckCircle2, XCircle,
  Play, RefreshCw, Video, Camera, Server, Gauge,
  ChevronDown, ChevronUp, Clock, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DiagResult {
  camera_id: string;
  camera_name: string;
  started_at: string;
  completed_at: string;
  ping: { reachable: boolean; latency_ms: number | null; host: string; port: number };
  rtsp: { available: boolean; latency_ms: number | null };
  api: { success: boolean; latency_ms: number | null; device_info: Record<string,string> | null; error: string | null; protocol: string };
  snapshot: { success: boolean; snapshot_url: string | null; error: string | null; file_size_bytes: number | null; latency_ms: number | null };
  overall: { passed: number; total: number; healthy: boolean; score: number };
}

interface CameraRow {
  id: string;
  name: string;
  ip_address: string;
  http_port: number;
  protocol: string;
  status: string;
  last_status_check: string | null;
  last_status_latency_ms: number | null;
  entrance_id: string | null;
  last_snapshot: string | null;
}

const CHECK_ICONS = {
  pass: <CheckCircle2 className="w-4 h-4 text-green-400" />,
  fail: <XCircle className="w-4 h-4 text-red-400" />,
  warn: <AlertCircle className="w-4 h-4 text-amber-400" />,
};

function ScoreRing({ score }: { score: number }) {
  const color = score === 100 ? "text-green-400" : score >= 66 ? "text-amber-400" : "text-red-400";
  return (
    <div className={cn("text-2xl font-bold font-mono", color)}>{score}%</div>
  );
}

function CheckRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className="text-sm text-right shrink-0">{value}</div>
    </div>
  );
}

function DiagCard({ camera, result, running, onRun }: {
  camera: CameraRow;
  result: DiagResult | null;
  running: boolean;
  onRun: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  const statusCls = camera.status === "online"
    ? "bg-green-500/15 text-green-400 border-green-500/20"
    : camera.status === "error"
    ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
    : "bg-red-500/15 text-red-400 border-red-500/20";

  const StatusIcon = camera.status === "online" ? Wifi : camera.status === "error" ? AlertCircle : WifiOff;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-foreground truncate">{camera.name}</div>
              <div className="text-xs text-muted-foreground font-mono">{camera.ip_address}:{camera.http_port}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={cn("text-xs", statusCls)}>
              <StatusIcon className="w-3 h-3 mr-1" />{camera.status}
            </Badge>
            {result && <ScoreRing score={result.overall.score} />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Last check info */}
        {camera.last_status_check && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {t("diag.lastCheck")}: {new Date(camera.last_status_check).toLocaleString()}
            {camera.last_status_latency_ms != null && (
              <span className="ml-1 text-foreground font-mono">{camera.last_status_latency_ms}ms</span>
            )}
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[
                { icon: result.ping.reachable ? CHECK_ICONS.pass : CHECK_ICONS.fail, label: t("diag.ping"), sub: result.ping.latency_ms != null ? `${result.ping.latency_ms}ms` : "—" },
                { icon: result.rtsp.available ? CHECK_ICONS.pass : CHECK_ICONS.warn, label: "RTSP", sub: result.rtsp.latency_ms != null ? `${result.rtsp.latency_ms}ms` : "N/A" },
                { icon: result.api.success ? CHECK_ICONS.pass : CHECK_ICONS.fail, label: result.api.protocol.toUpperCase(), sub: result.api.latency_ms != null ? `${result.api.latency_ms}ms` : "—" },
                { icon: result.snapshot.success ? CHECK_ICONS.pass : CHECK_ICONS.fail, label: t("diag.snapshot"), sub: result.snapshot.file_size_bytes != null ? `${Math.round(result.snapshot.file_size_bytes/1024)}KB` : "—" },
              ].map(({ icon, label, sub }) => (
                <div key={label} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-muted/30 border border-border/40">
                  {icon}
                  <span className="text-[10px] font-medium text-foreground">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{sub}</span>
                </div>
              ))}
            </div>

            {/* Errors */}
            {result.api.error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 mb-2">
                API: {result.api.error}
              </div>
            )}
            {result.snapshot.error && !result.snapshot.success && (
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 mb-2">
                Snapshot: {result.snapshot.error}
              </div>
            )}

            {/* Expandable device info */}
            {result.api.device_info && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {t("diag.deviceInfo")}
              </button>
            )}
            {expanded && result.api.device_info && (
              <div className="text-xs space-y-1 border border-border/40 rounded-lg p-2.5 bg-muted/20">
                {Object.entries(result.api.device_info)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground/60 capitalize">{k.replace(/_/g, " ")}</span>
                      <span className="font-mono text-right">{v}</span>
                    </div>
                  ))}
              </div>
            )}

            {/* Snapshot preview */}
            {result.snapshot.snapshot_url && (
              <div className="mt-2 rounded-lg overflow-hidden border border-border/40 h-24">
                <img
                  src={result.snapshot.snapshot_url}
                  alt="snapshot"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        )}

        <Button
          size="sm"
          className="w-full"
          onClick={onRun}
          disabled={running}
          variant={result?.overall.healthy ? "outline" : "default"}
        >
          {running ? (
            <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-2" />
          )}
          {running ? t("diag.testing") : t("diag.testConnection")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DiagnosticsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [results, setResults] = useState<Record<string, DiagResult>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());

  const { data: cameras = [], isLoading } = useQuery<CameraRow[]>({
    queryKey: ["diag-cameras"],
    queryFn: () => api.get("/diagnostics/cameras"),
    refetchInterval: 30000,
  });

  const { data: sysHealth } = useQuery({
    queryKey: ["diag-system"],
    queryFn: () => api.get<any>("/diagnostics/system"),
    refetchInterval: 15000,
  });

  async function runDiag(cameraId: string) {
    setRunning((prev) => new Set([...prev, cameraId]));
    try {
      const result = await api.post<DiagResult>(`/diagnostics/camera/${cameraId}`, {});
      setResults((prev) => ({ ...prev, [cameraId]: result }));
      qc.invalidateQueries({ queryKey: ["diag-cameras"] });
      qc.invalidateQueries({ queryKey: ["cameras"] });
      const score = result.overall.score;
      toast({
        title: `${result.camera_name} — ${score}%`,
        description: `${result.overall.passed}/${result.overall.total} checks passed`,
        variant: score === 100 ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    } finally {
      setRunning((prev) => { const s = new Set(prev); s.delete(cameraId); return s; });
    }
  }

  async function runAll() {
    await Promise.allSettled(cameras.map((c) => runDiag(c.id)));
  }

  const online = cameras.filter((c) => c.status === "online").length;
  const allRunning = running.size === cameras.length && cameras.length > 0;

  return (
    <AppLayout
      title={t("diag.title")}
      subtitle={t("diag.subtitle")}
      actions={
        <Button
          size="sm"
          onClick={runAll}
          disabled={allRunning || cameras.length === 0}
        >
          {allRunning
            ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            : <Play className="w-4 h-4 mr-2" />}
          {t("diag.testAll")}
        </Button>
      }
    >
      <div className="max-w-7xl mx-auto space-y-6">

        {/* System health bar */}
        {sysHealth && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(sysHealth.components as Record<string, { status: string; latency_ms: number | null; detail: string }>).map(([name, comp]) => {
              const ok = comp.status === "ok";
              const nc = comp.status === "not_configured";
              return (
                <div key={name} className={cn(
                  "rounded-lg border p-3 text-center",
                  ok ? "border-green-500/20 bg-green-500/5"
                     : nc ? "border-border/40 bg-muted/20"
                     : "border-red-500/20 bg-red-500/5"
                )}>
                  <div className={cn("text-xs font-semibold uppercase tracking-wide mb-1",
                    ok ? "text-green-400" : nc ? "text-muted-foreground/60" : "text-red-400"
                  )}>
                    {ok ? "●" : nc ? "○" : "✕"} {name.replace(/_/g, " ")}
                  </div>
                  {comp.latency_ms != null && (
                    <div className="text-[10px] text-muted-foreground">{comp.latency_ms}ms</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* System stats */}
        {sysHealth && (
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />{t("diag.uptime")}: <span className="text-foreground font-mono">{Math.floor(sysHealth.uptime_seconds / 60)}m</span></span>
            <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5" />RAM: <span className="text-foreground font-mono">{sysHealth.memory_mb}MB</span></span>
            <span className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />{sysHealth.node_version}</span>
            <span className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" />{online}/{cameras.length} {t("diag.camerasOnline")}</span>
          </div>
        )}

        {/* Camera grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
          </div>
        ) : cameras.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              {t("diag.noCameras")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map((c) => (
              <DiagCard
                key={c.id}
                camera={c}
                result={results[c.id] ?? null}
                running={running.has(c.id)}
                onRun={() => runDiag(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
