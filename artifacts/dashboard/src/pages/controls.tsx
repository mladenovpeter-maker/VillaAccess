/**
 * Quick Controls — operator-facing page with one-tap action buttons
 * for every intercom (door open) and every gate camera (gate open)
 * registered in the system.
 *
 * Read-only + action only. No edit/delete/CRUD. Visible to operators
 * and admins. Uses existing backend endpoints from Phase 0/1:
 *   POST /api/intercoms/:id/open
 *   POST /api/cameras/:id/gate
 *
 * Live status badges refresh every 30 s.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  intercomsApi, camerasApi, entrancesApi,
  type Intercom, type Camera, type Entrance,
} from "@/lib/api";
import {
  DoorOpen, Camera as CameraIcon, Wifi, WifiOff, AlertCircle,
  Loader2, KeyRound, MapPin, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "online" | "offline" | "error" }) {
  const cls =
    status === "online" ? "bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]"
    : status === "error" ? "bg-amber-400 animate-pulse"
    : "bg-zinc-500";
  return <span className={cn("w-2 h-2 rounded-full shrink-0", cls)} />;
}

function StatusIcon({ status }: { status: "online" | "offline" | "error" }) {
  if (status === "online") return <Wifi className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "error")  return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
  return <WifiOff className="w-3.5 h-3.5 text-zinc-500" />;
}

// ─── Intercom action card ─────────────────────────────────────────────────────

function IntercomActionCard({ intercom, entranceName }: { intercom: Intercom; entranceName?: string }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const openMut = useMutation({
    mutationFn: () => intercomsApi.open(intercom.id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["intercoms"] });
      toast({
        title: r?.success ? t("controls.doorOpened") : t("controls.doorFailed"),
        description: r?.close_warning
          ? `${intercom.name} · ${r.close_warning}`
          : intercom.name,
        variant: r?.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({
      title: t("controls.doorFailed"),
      description: `${intercom.name}: ${e.message}`,
      variant: "destructive",
    }),
  });

  const offline = intercom.status !== "online";

  return (
    <div className={cn(
      "bg-card border rounded-xl p-4 space-y-3 transition-colors",
      offline ? "border-border/40 opacity-80" : "border-border hover:border-primary/40",
    )}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <KeyRound className="w-5 h-5 text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground truncate">{intercom.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
            <StatusIcon status={intercom.status} />
            <span className="capitalize">{intercom.status}</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono border-border/60">
              door {intercom.relay_no}{intercom.door_count > 1 ? `/${intercom.door_count}` : ""}
            </Badge>
            <span className="font-mono text-muted-foreground/70">{intercom.ip_address}</span>
          </div>
          {entranceName && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
              <MapPin className="w-3 h-3" />{entranceName}
            </div>
          )}
        </div>
      </div>

      <Button
        size="lg"
        className="w-full h-12 gap-2 text-base font-semibold"
        onClick={() => openMut.mutate()}
        disabled={openMut.isPending}
      >
        {openMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <DoorOpen className="w-5 h-5" />}
        {openMut.isPending ? t("controls.opening") : t("controls.openDoor")}
      </Button>
    </div>
  );
}

// ─── Camera (gate) action card ────────────────────────────────────────────────

function CameraActionCard({ camera, entranceName }: { camera: Camera; entranceName?: string }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const gateMut = useMutation({
    mutationFn: () => camerasApi.gate(camera.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({
        title: r.success ? t("controls.gateOpened") : t("controls.gateFailed"),
        description: r.success
          ? `${camera.name} · gate ${camera.gate_no}`
          : `${camera.name}: ${r.error ?? t("controls.unknownError")}`,
        variant: r.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({
      title: t("controls.gateFailed"),
      description: `${camera.name}: ${e.message}`,
      variant: "destructive",
    }),
  });

  const offline = camera.status !== "online";

  return (
    <div className={cn(
      "bg-card border rounded-xl p-4 space-y-3 transition-colors",
      offline ? "border-border/40 opacity-80" : "border-border hover:border-primary/40",
    )}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
          <CameraIcon className="w-5 h-5 text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground truncate">{camera.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
            <StatusIcon status={camera.status} />
            <span className="capitalize">{camera.status}</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono border-border/60">
              gate {camera.gate_no}
            </Badge>
            <span className="font-mono text-muted-foreground/70">{camera.ip_address}</span>
          </div>
          {entranceName && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
              <MapPin className="w-3 h-3" />{entranceName}
            </div>
          )}
        </div>
      </div>

      <Button
        size="lg"
        variant="secondary"
        className="w-full h-12 gap-2 text-base font-semibold"
        onClick={() => gateMut.mutate()}
        disabled={gateMut.isPending}
      >
        {gateMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        {gateMut.isPending ? t("controls.opening") : t("controls.openGate")}
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ControlsPage() {
  const { t } = useTranslation();
  const { data: intercoms = [], isLoading: icLoading } = useQuery<Intercom[]>({
    queryKey: ["intercoms"],
    queryFn: () => intercomsApi.list(),
    refetchInterval: 30_000,
  });

  const { data: cameras = [], isLoading: camLoading } = useQuery<Camera[]>({
    queryKey: ["cameras"],
    queryFn: () => camerasApi.list(),
    refetchInterval: 30_000,
  });

  const { data: entrances = [] } = useQuery<Entrance[]>({
    queryKey: ["entrances"],
    queryFn: () => entrancesApi.list(),
  });

  const entranceMap: Record<string, string> = Object.fromEntries(entrances.map((e) => [e.id, e.name]));
  const isLoading = icLoading || camLoading;

  // Online counts for header
  const intercomsOnline = intercoms.filter((i) => i.status === "online").length;
  const camerasOnline   = cameras.filter((c) => c.status === "online").length;

  return (
    <AppLayout
      title={t("controls.title")}
      subtitle={t("controls.subtitle")}
    >
      <div className="p-6 space-y-8 max-w-6xl mx-auto">

        {/* Header summary */}
        {!isLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="w-3.5 h-3.5" />{t("controls.intercomsLabel")}
              </div>
              <div className="text-2xl font-bold mt-1 font-mono">
                <span className="text-emerald-400">{intercomsOnline}</span>
                <span className="text-muted-foreground">/{intercoms.length}</span>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CameraIcon className="w-3.5 h-3.5" />{t("controls.camerasLabel")}
              </div>
              <div className="text-2xl font-bold mt-1 font-mono">
                <span className="text-emerald-400">{camerasOnline}</span>
                <span className="text-muted-foreground">/{cameras.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* Intercoms section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-violet-400" />{t("controls.intercomsTitle")}
            </h2>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {t("controls.deviceCount", { count: intercoms.length })}
              </span>
            )}
          </div>

          {icLoading ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          ) : intercoms.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
              <KeyRound className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">{t("controls.noIntercoms")}</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {intercoms.map((ic) => (
                <IntercomActionCard
                  key={ic.id}
                  intercom={ic}
                  entranceName={ic.entrance_id ? entranceMap[ic.entrance_id] : undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* Cameras section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CameraIcon className="w-5 h-5 text-sky-400" />{t("controls.camerasTitle")}
            </h2>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {t("controls.deviceCount", { count: cameras.length })}
              </span>
            )}
          </div>

          {camLoading ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          ) : cameras.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
              <CameraIcon className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">{t("controls.noCameras")}</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cameras.map((cam) => (
                <CameraActionCard
                  key={cam.id}
                  camera={cam}
                  entranceName={cam.entrance_id ? entranceMap[cam.entrance_id] : undefined}
                />
              ))}
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
          {t("controls.autoRefreshNote")}
        </p>
      </div>
    </AppLayout>
  );
}
