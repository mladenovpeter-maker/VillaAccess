import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import {
  Search, ChevronLeft, ChevronRight, Camera,
  CheckCircle2, XCircle, Clock, ZoomIn, Car,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SnapshotItem {
  id: string;
  vehicle_id: string | null;
  access_event_id: string | null;
  camera_id: string | null;
  snapshot_url: string;
  thumbnail_url: string | null;
  confidence_score: number | null;
  ocr_text: string | null;
  ai_annotations: Record<string, unknown> | null;
  is_primary: boolean;
  captured_at: string;
  vehicle_plate: string | null;
  vehicle_status: string | null;
  event_status: string | null;
  entrance_name: string | null;
}

interface SnapshotsResponse {
  items: SnapshotItem[];
  total: number;
  page: number;
  page_size: number;
}

async function fetchSnapshots(params: Record<string, string>): Promise<SnapshotsResponse> {
  const qs = new URLSearchParams(params).toString();
  const token = tokenStore.getAccess();
  const res = await fetch(`${BASE}/api/snapshots?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch snapshots");
  return res.json();
}

function ConfBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? "text-green-400 border-green-500/30 bg-green-500/10"
            : pct >= 50 ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
            : "text-red-400 border-red-500/30 bg-red-500/10";
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 h-5 border font-mono", cls)}>
      {pct}%
    </Badge>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const cfg: Record<string, string> = {
    allowed: "bg-green-500/15 text-green-400 border-green-500/20",
    denied:  "bg-red-500/15 text-red-400 border-red-500/20",
    manual:  "bg-blue-500/15 text-blue-400 border-blue-500/20",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  };
  const Icon = status === "allowed" ? CheckCircle2 : status === "denied" ? XCircle : Clock;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 h-5 border flex items-center gap-1", cfg[status] ?? "bg-muted/50 text-muted-foreground border-border")}>
      <Icon className="w-2.5 h-2.5" />{status}
    </Badge>
  );
}

function SnapshotCard({ item, onZoom }: { item: SnapshotItem; onZoom: () => void }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="group relative rounded-xl overflow-hidden border border-border/50 bg-card cursor-pointer hover:border-primary/40 transition-all"
      onClick={onZoom}
    >
      <div className="relative aspect-video bg-black/40">
        {!imgError ? (
          <img
            src={item.snapshot_url}
            alt={item.ocr_text ?? "snapshot"}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-8 h-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {/* Top badges */}
        <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap">
          {item.is_primary && (
            <span className="bg-yellow-500/90 text-black text-[10px] px-1.5 py-0.5 rounded font-bold">PRIMARY</span>
          )}
          <ConfBadge score={item.confidence_score} />
        </div>
        {/* Bottom badges */}
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1">
          {item.ocr_text && (
            <span className="bg-black/80 text-white text-[11px] px-2 py-0.5 rounded font-mono font-bold">
              {item.ocr_text}
            </span>
          )}
          {item.event_status && <StatusBadge status={item.event_status} />}
        </div>
      </div>
      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          {item.vehicle_plate && (
            <span className="text-xs font-mono font-semibold text-foreground">{item.vehicle_plate}</span>
          )}
          {item.vehicle_status === "blacklisted" && (
            <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/20 bg-red-500/10 h-4 px-1">blacklisted</Badge>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Camera className="w-2.5 h-2.5" />
            {item.entrance_name ?? item.camera_id?.slice(0, 8) ?? "—"}
          </span>
          <span>{new Date(item.captured_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        {item.ai_annotations && Object.keys(item.ai_annotations).length > 0 && (
          <div className="text-[10px] text-muted-foreground/60 truncate">
            {JSON.stringify(item.ai_annotations)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lightbox, setLightbox] = useState<SnapshotItem | null>(null);

  const params: Record<string, string> = {
    page: String(page),
    page_size: "24",
  };
  if (search) params.plate = search;
  if (statusFilter !== "all") params.event_status = statusFilter;

  const { data, isLoading } = useQuery<SnapshotsResponse>({
    queryKey: ["gallery", page, search, statusFilter],
    queryFn: () => fetchSnapshots(params),
    placeholderData: (prev) => prev,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / 24);

  return (
    <AppLayout title={t("gallery.title")} subtitle={t("gallery.subtitle")}>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("gallery.searchPlate")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="allowed">{t("access.status.allowed")}</SelectItem>
              <SelectItem value="denied">{t("access.status.denied")}</SelectItem>
              <SelectItem value="manual">{t("access.status.manual")}</SelectItem>
              <SelectItem value="pending">{t("access.status.pending")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">
            {data?.total ?? 0} {t("gallery.snapshots")}
          </span>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-xl" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              {t("gallery.noSnapshots")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {data.items.map((item) => (
              <SnapshotCard key={item.id} item={item} onZoom={() => setLightbox(item)} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-2 gap-0 bg-black/95 border-border/20">
          {lightbox && (
            <div className="space-y-3">
              <img
                src={lightbox.snapshot_url}
                alt={lightbox.ocr_text ?? "snapshot"}
                className="w-full max-h-[70vh] object-contain rounded-lg"
              />
              <div className="px-2 flex flex-wrap items-center gap-3 text-xs text-white/70">
                {lightbox.ocr_text && <span className="font-mono font-bold text-white text-sm">{lightbox.ocr_text}</span>}
                <ConfBadge score={lightbox.confidence_score} />
                {lightbox.event_status && <StatusBadge status={lightbox.event_status} />}
                {lightbox.entrance_name && <span className="flex items-center gap-1"><Camera className="w-3 h-3" />{lightbox.entrance_name}</span>}
                <span className="ml-auto">{new Date(lightbox.captured_at).toLocaleString()}</span>
              </div>
              {lightbox.ai_annotations && Object.keys(lightbox.ai_annotations).length > 0 && (
                <pre className="text-[10px] text-white/40 px-2 overflow-x-auto">
                  {JSON.stringify(lightbox.ai_annotations, null, 2)}
                </pre>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
