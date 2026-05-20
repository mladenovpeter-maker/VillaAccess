import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  camerasApi, villasApi,
  type Camera, type CameraStatusResult, type CameraActionResult,
} from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Camera as CameraIcon, Wifi, WifiOff, AlertCircle, RefreshCw,
  DoorOpen, GitMerge, ImageIcon, Activity, ChevronDown, ChevronUp,
  Clock, Cpu, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  online:  { label: "Online",  cls: "bg-green-500/15 text-green-400 border-green-500/20",  Icon: Wifi        },
  offline: { label: "Offline", cls: "bg-red-500/15 text-red-400 border-red-500/20",        Icon: WifiOff     },
  error:   { label: "Error",   cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20", Icon: AlertCircle },
};

const PROTOCOL_LABELS: Record<string, string> = {
  hikvision: "Hikvision ISAPI",
  dahua:     "Dahua HTTP",
  onvif:     "ONVIF",
  rtsp:      "RTSP",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatLatency(ms: number | null) {
  if (ms == null) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// ─── Action button with loading + result feedback ─────────────────────────────

function ActionButton({
  icon: Icon, label, onClick, variant = "outline", disabled = false, loading = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: "outline" | "default" | "destructive" | "secondary";
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className="h-8 text-xs gap-1.5"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading
        ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8v8H4z"/></svg>
        : <Icon className="w-3.5 h-3.5" />}
      {label}
    </Button>
  );
}

// ─── CameraCard ───────────────────────────────────────────────────────────────

function CameraCard({ camera, villaName }: { camera: Camera; villaName?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [liveSnap, setLiveSnap] = useState<string | null>(null);

  const cfg = STATUS_CFG[camera.status] ?? STATUS_CFG.offline;
  const StatusIcon = cfg.Icon;

  // ── Snapshot mutation ──────────────────────────────────────────────────────
  const snapMut = useMutation({
    mutationFn: () => camerasApi.snapshot(camera.id),
    onSuccess: (r: CameraActionResult) => {
      if (r.success && r.snapshot_url) {
        setLiveSnap(r.snapshot_url);
        toast({ title: `Snapshot captured`, description: camera.name });
      } else {
        toast({
          title: "Snapshot failed",
          description: r.error ?? "Camera did not respond",
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Status mutation ────────────────────────────────────────────────────────
  const statusMut = useMutation({
    mutationFn: () => camerasApi.status(camera.id),
    onSuccess: (r: CameraStatusResult) => {
      toast({
        title: r.online ? `Online · ${formatLatency(r.latency_ms ?? null)}` : "Offline",
        description: r.device_info?.model
          ? `${r.device_info.model} — fw ${r.device_info.firmware_version ?? "?"}`
          : r.error ?? camera.name,
        variant: r.online ? "default" : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Gate mutation ──────────────────────────────────────────────────────────
  const gateMut = useMutation({
    mutationFn: () => camerasApi.gate(camera.id),
    onSuccess: (r: CameraActionResult) => {
      toast({
        title: r.success ? "Gate opened" : "Gate failed",
        description: r.success
          ? `${camera.name} — relay ${r.target_no} (${r.mode})`
          : r.error ?? "No response from camera",
        variant: r.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Gate error", description: e.message, variant: "destructive" }),
  });

  // ── Door mutation ──────────────────────────────────────────────────────────
  const doorMut = useMutation({
    mutationFn: () => camerasApi.door(camera.id),
    onSuccess: (r: CameraActionResult) => {
      toast({
        title: r.success ? "Door opened" : "Door failed",
        description: r.success
          ? `${camera.name} — relay ${r.target_no} (${r.mode})`
          : r.error ?? "No response from camera",
        variant: r.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Door error", description: e.message, variant: "destructive" }),
  });

  const displaySnap = liveSnap ?? camera.snapshot_url;
  const anyLoading = snapMut.isPending || statusMut.isPending || gateMut.isPending || doorMut.isPending;

  return (
    <Card className={cn(
      "overflow-hidden transition-all",
      camera.status === "online" ? "hover:border-primary/40" : "opacity-80",
    )}>
      {/* Snapshot / feed area */}
      <div className="relative bg-black/40 aspect-video flex items-center justify-center border-b border-border overflow-hidden">
        {displaySnap ? (
          <img
            src={displaySnap}
            alt={camera.name}
            className="w-full h-full object-cover"
            key={displaySnap}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <CameraIcon className="w-8 h-8" />
            <span className="text-xs">{camera.status === "online" ? "No snapshot yet" : "No signal"}</span>
          </div>
        )}

        {/* Status badge */}
        <div className={cn(
          "absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border font-medium",
          cfg.cls,
        )}>
          <StatusIcon className="w-3 h-3" />
          {cfg.label}
        </div>

        {/* REC indicator */}
        {camera.status === "online" && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-red-600/80 text-white font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />REC
          </div>
        )}

        {/* Latency pill */}
        {camera.last_status_latency_ms != null && camera.status === "online" && (
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
            {formatLatency(camera.last_status_latency_ms)}
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-3">
        {/* Name + villa + protocol */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm text-foreground truncate">{camera.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {villaName && (
                <span className="text-xs text-muted-foreground">{villaName}</span>
              )}
              <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 font-mono border-border/60">
                {PROTOCOL_LABELS[camera.protocol] ?? camera.protocol}
              </Badge>
            </div>
          </div>
          <span className="font-mono text-xs text-muted-foreground/60 shrink-0 mt-0.5">
            Ch {camera.channel_no}
          </span>
        </div>

        {/* IP + last snapshot */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div className="font-mono flex items-center gap-1.5">
            <Radio className="w-3 h-3" />{camera.ip_address}:{camera.http_port}
          </div>
          {camera.last_snapshot && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Last snap {formatTime(camera.last_snapshot)}
            </div>
          )}
          {camera.model && <div className="flex items-center gap-1.5"><Cpu className="w-3 h-3" />{camera.model}</div>}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            icon={ImageIcon}
            label="Snapshot"
            onClick={() => snapMut.mutate()}
            loading={snapMut.isPending}
            disabled={anyLoading}
          />
          <ActionButton
            icon={Activity}
            label="Ping"
            onClick={() => statusMut.mutate()}
            loading={statusMut.isPending}
            disabled={anyLoading}
          />
          <ActionButton
            icon={GitMerge}
            label="Gate"
            onClick={() => gateMut.mutate()}
            loading={gateMut.isPending}
            disabled={anyLoading}
            variant="secondary"
          />
          <ActionButton
            icon={DoorOpen}
            label="Door"
            onClick={() => doorMut.mutate()}
            loading={doorMut.isPending}
            disabled={anyLoading}
            variant="secondary"
          />
        </div>

        {/* Expandable device info */}
        {camera.device_info && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Device info
            </button>
            {expanded && (
              <div className="mt-2 text-xs space-y-1 text-muted-foreground border border-border/40 rounded-lg p-2.5 bg-muted/20">
                {Object.entries({
                  Name: camera.device_info.device_name,
                  Model: camera.device_info.model,
                  "S/N": camera.device_info.serial_number,
                  Firmware: camera.device_info.firmware_version,
                  Hardware: camera.device_info.hardware_version,
                  MAC: camera.device_info.mac_address,
                  IP: camera.device_info.ipv4,
                })
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground/60">{k}</span>
                      <span className="font-mono text-right truncate">{v}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Access control mode indicator */}
        {camera.use_access_control && (
          <div className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1">
            Access control mode · Door {camera.gate_no} / {camera.door_no}
          </div>
        )}
        {!camera.use_access_control && (
          <div className="text-[10px] text-muted-foreground/50">
            I/O relay · Output {camera.gate_no} (gate) · {camera.door_no} (door)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CamerasPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ["cameras"],
    queryFn: camerasApi.list,
    refetchInterval: 30_000,
  });

  const { data: villas = [] } = useQuery({
    queryKey: ["villas"],
    queryFn: () => import("@/lib/api").then((m) => m.villasApi.list()),
  });

  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));

  const online  = cameras.filter((c) => c.status === "online").length;
  const offline = cameras.filter((c) => c.status === "offline").length;
  const error   = cameras.filter((c) => c.status === "error").length;

  // Ping all cameras at once
  const pingAllMut = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(cameras.map((c) => camerasApi.status(c.id)));
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({ title: "Status refresh complete", description: `${cameras.length} cameras checked` });
    },
  });

  return (
    <AppLayout
      title="Cameras"
      subtitle={`${cameras.length} cameras · ${online} online`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => pingAllMut.mutate()}
          disabled={pingAllMut.isPending || cameras.length === 0}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", pingAllMut.isPending && "animate-spin")} />
          Ping All
        </Button>
      }
    >
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Summary stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-muted-foreground">{online} online</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-muted-foreground">{offline} offline</span>
          </div>
          {error > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-muted-foreground">{error} error</span>
            </div>
          )}
          <span className="text-muted-foreground">{cameras.length} total</span>
        </div>

        {/* Camera grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : cameras.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              No cameras configured.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map((c) => (
              <CameraCard
                key={c.id}
                camera={c}
                villaName={c.entrance_id ? villaMap[c.entrance_id] : undefined}
              />
            ))}
          </div>
        )}

        {/* Protocol legend */}
        <div className="text-xs text-muted-foreground border border-border rounded-lg px-4 py-3 bg-muted/20 space-y-1">
          <div className="font-medium text-foreground/70 mb-1.5">Supported protocols</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div><span className="font-mono text-primary">Hikvision ISAPI</span> — snapshot, gate relay, status</div>
            <div><span className="font-mono text-muted-foreground/60">Dahua HTTP</span> — stub (planned)</div>
            <div><span className="font-mono text-muted-foreground/60">ONVIF Profile S</span> — stub (planned)</div>
            <div><span className="font-mono text-muted-foreground/60">RTSP only</span> — no control API</div>
          </div>
          <div className="pt-1 text-muted-foreground/50">
            Gate/Door: I/O relay mode uses <span className="font-mono">PUT /ISAPI/System/IO/outputs/&#123;n&#125;/trigger</span>.
            Access-control mode uses <span className="font-mono">PUT /ISAPI/AccessControl/RemoteControl/door/&#123;n&#125;</span>.
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
