import { useQuery } from "@tanstack/react-query";
import { camerasApi, villasApi, type Camera } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera as CameraIcon, Wifi, WifiOff, AlertCircle, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const statusConfig = {
  online: { label: "Online", className: "bg-green-500/15 text-green-400 border-green-500/20", icon: Wifi },
  offline: { label: "Offline", className: "bg-red-500/15 text-red-400 border-red-500/20", icon: WifiOff },
  error: { label: "Error", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20", icon: AlertCircle },
};

function CameraCard({ camera, villaName }: { camera: Camera; villaName?: string }) {
  const config = statusConfig[camera.status as keyof typeof statusConfig] ?? statusConfig.offline;
  const StatusIcon = config.icon;

  return (
    <Card className={cn(
      "overflow-hidden transition-colors",
      camera.status === "online" ? "hover:border-primary/40" : "opacity-75"
    )}>
      {/* Snapshot placeholder */}
      <div className="relative bg-black/40 aspect-video flex items-center justify-center border-b border-border">
        {camera.snapshot_url ? (
          <img src={camera.snapshot_url} alt={camera.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <CameraIcon className="w-8 h-8" />
            <span className="text-xs">{camera.status === "online" ? "Live feed" : "No signal"}</span>
          </div>
        )}
        {/* Status badge overlay */}
        <div className={cn(
          "absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border font-medium",
          config.className
        )}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </div>
        {/* Recording indicator */}
        {camera.status === "online" && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-red-500/80 text-white font-medium">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            REC
          </div>
        )}
      </div>

      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm text-foreground truncate">{camera.name}</div>
            {villaName && <div className="text-xs text-muted-foreground truncate">{villaName}</div>}
          </div>
          <Monitor className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="font-mono">{camera.ip_address}</div>
          {camera.model && <div className="truncate">{camera.model}</div>}
          {camera.last_snapshot && (
            <div>Last snap: {new Date(camera.last_snapshot).toLocaleTimeString()}</div>
          )}
        </div>
        {camera.rtsp_url && (
          <div className="mt-2 font-mono text-xs text-muted-foreground/60 truncate" title={camera.rtsp_url}>
            {camera.rtsp_url}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CamerasPage() {
  const { data: cameras = [], isLoading: camsLoading } = useQuery({
    queryKey: ["cameras"], queryFn: camerasApi.list, refetchInterval: 30000,
  });
  const { data: villas = [] } = useQuery({ queryKey: ["villas"], queryFn: () => import("@/lib/api").then(m => m.villasApi.list()) });

  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));
  const onlineCount = cameras.filter((c) => c.status === "online").length;
  const offlineCount = cameras.filter((c) => c.status !== "online").length;

  return (
    <AppLayout title="Cameras" subtitle="Hikvision camera feeds and status">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Summary */}
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-muted-foreground">{onlineCount} online</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-muted-foreground">{offlineCount} offline</span>
          </div>
          <div className="text-muted-foreground">{cameras.length} total cameras</div>
        </div>

        {/* Camera grid */}
        {camsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        ) : cameras.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">No cameras configured.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map((c) => (
              <CameraCard key={c.id} camera={c} villaName={c.villa_id ? villaMap[c.villa_id] : undefined} />
            ))}
          </div>
        )}

        {/* Info note */}
        <div className="text-xs text-muted-foreground border border-border rounded-lg px-4 py-3 bg-muted/20">
          <strong>Production note:</strong> Live RTSP streams are rendered by the Python AI worker via OpenCV. Camera cards above show metadata from the database. In the Docker deployment, clicking a camera opens its RTSP stream through the AI worker proxy.
        </div>
      </div>
    </AppLayout>
  );
}
