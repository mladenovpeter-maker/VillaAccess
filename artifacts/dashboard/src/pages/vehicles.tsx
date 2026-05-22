import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vehiclesApi, type Vehicle, type VehicleSnapshot } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, Search, Car, Clock, Eye, Upload,
  X, ImageIcon, Star, Camera, AlertTriangle, CheckCircle2,
  ChevronLeft, ChevronRight, ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { tokenStore } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE_URL}/api`;

const STATUS_STYLES: Record<string, string> = {
  known: "bg-green-500/15 text-green-400 border-green-500/30",
  unknown: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  blacklisted: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  known: <CheckCircle2 className="w-3 h-3" />,
  unknown: <Clock className="w-3 h-3" />,
  blacklisted: <AlertTriangle className="w-3 h-3" />,
};

const VEHICLE_TYPES = ["sedan", "suv", "van", "truck", "motorcycle", "other"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface VehicleForm {
  license_plate: string;
  make: string;
  model: string;
  color: string;
  vehicle_type: string;
  owner_name: string;
  plate_region: string;
  status: string;
  access_type: "reservation" | "permanent";
  notes: string;
}

const defaultForm: VehicleForm = {
  license_plate: "", make: "", model: "", color: "",
  vehicle_type: "sedan", owner_name: "", plate_region: "",
  status: "unknown", access_type: "reservation", notes: "",
};

type DetailTab = "snapshots" | "events";

// ─── Snapshot upload ──────────────────────────────────────────────────────────

async function uploadSnapshot(
  vehicleId: string,
  file: File,
  opts: { is_primary?: boolean; ocr_hint?: string; camera_id?: string },
): Promise<{ snapshot: VehicleSnapshot; vehicle: { snapshot_url: string | null } }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("vehicle_id", vehicleId);
  if (opts.is_primary) fd.append("is_primary", "true");
  if (opts.ocr_hint) fd.append("ocr_hint", opts.ocr_hint);
  if (opts.camera_id) fd.append("camera_id", opts.camera_id);

  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/snapshots/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatConf(score: number | null) {
  if (score == null) return null;
  return `${Math.round(score * 100)}%`;
}

// ─── SnapshotImage ────────────────────────────────────────────────────────────

function SnapshotImage({
  src, alt, className, onClick,
}: { src: string | null; alt: string; className?: string; onClick?: () => void }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className={cn("flex items-center justify-center bg-card", className)} onClick={onClick}>
        <Car className="w-8 h-8 text-muted-foreground/30" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-cover", className)}
      onError={() => setError(true)}
      onClick={onClick}
    />
  );
}

// ─── UploadZone ───────────────────────────────────────────────────────────────

function UploadZone({
  vehicleId, onSuccess,
}: { vehicleId: string; onSuccess: () => void }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [ocrHint, setOcrHint] = useState("");
  const [uploading, setUploading] = useState(false);

  const selectFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast({ title: t("vehicles.invalidFile"), description: t("vehicles.onlyImages"), variant: "destructive" });
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  }, []);

  const clear = () => { setFile(null); setPreview(null); setOcrHint(""); setIsPrimary(false); };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadSnapshot(vehicleId, file, { is_primary: isPrimary, ocr_hint: ocrHint || undefined });
      toast({ title: t("vehicles.snapshotUploaded"), description: isPrimary ? t("vehicles.setPrimarySuccess") : t("vehicles.addedToGallery") });
      clear();
      onSuccess();
    } catch (err: any) {
      toast({ title: t("vehicles.uploadFailed"), description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      {!file ? (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30",
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground font-medium">
            {t("vehicles.dropImage")} <span className="text-primary">{t("vehicles.clickToBrowse")}</span>
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">{t("vehicles.maxSize")}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Preview */}
          <div className="relative rounded-xl overflow-hidden bg-card border border-border">
            <img src={preview!} alt="preview" className="w-full h-48 object-cover" />
            <button
              onClick={clear}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
            <div className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="rounded"
              />
              <Star className="w-3.5 h-3.5 text-yellow-500" />
              {t("vehicles.setPrimary")}
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("vehicles.licensePlateHint")} <span className="font-normal">{t("vehicles.forOcr")}</span>
            </label>
            <Input
              value={ocrHint}
              onChange={(e) => setOcrHint(e.target.value.toUpperCase())}
              placeholder="e.g. B 1234 ABC"
              className="font-mono text-sm"
            />
          </div>

          <Button className="w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t("vehicles.uploading")}
              </span>
            ) : (
              <span className="flex items-center gap-2"><Upload className="w-4 h-4" />{t("vehicles.uploadSnapshot")}</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── SnapshotGallery ──────────────────────────────────────────────────────────

function SnapshotGallery({
  vehicleId, onPrimaryChange,
}: { vehicleId: string; onPrimaryChange: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<VehicleSnapshot | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  const { data, isLoading } = useQuery({
    queryKey: ["snapshots", vehicleId, page],
    queryFn: () => vehiclesApi.snapshots(vehicleId, page, PAGE_SIZE),
  });

  const deleteMut = useMutation({
    mutationFn: async (s: VehicleSnapshot) => {
      const token = tokenStore.getAccess();
      const res = await fetch(`${API_BASE}/snapshots/${s.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
      if (s.is_primary) onPrimaryChange();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshots", vehicleId] });
      toast({ title: t("vehicles.snapshotDeleted") });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const primaryMut = useMutation({
    mutationFn: async (s: VehicleSnapshot) => {
      const token = tokenStore.getAccess();
      const res = await fetch(`${API_BASE}/vehicles/${vehicleId}/snapshots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          snapshot_url: s.snapshot_url,
          thumbnail_url: s.thumbnail_url,
          is_primary: true,
          captured_at: s.captured_at,
        }),
      });
      if (!res.ok) throw new Error("Failed to set primary");
      onPrimaryChange();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshots", vehicleId] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast({ title: t("vehicles.primaryUpdated") });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{t("vehicles.noSnapshots")}</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / PAGE_SIZE);

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {data.items.map((snap) => (
          <div
            key={snap.id}
            className="relative group rounded-lg overflow-hidden border border-border bg-card aspect-video"
          >
            <SnapshotImage
              src={snap.snapshot_url}
              alt="snapshot"
              className="w-full h-full cursor-zoom-in"
              onClick={() => setLightbox(snap)}
            />

            {/* Badges */}
            <div className="absolute top-1 left-1 flex gap-1">
              {snap.is_primary && (
                <span className="bg-yellow-500/90 text-black text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5" />PRIMARY
                </span>
              )}
              {snap.confidence_score != null && (
                <span className="bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {formatConf(snap.confidence_score)}
                </span>
              )}
            </div>

            {/* OCR badge */}
            {snap.ocr_text && (
              <div className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                {snap.ocr_text}
              </div>
            )}
            {!snap.ocr_text && (snap.ai_annotations as any)?.ocr_status === "pending" && (
              <div className="absolute bottom-1 left-1 bg-blue-900/80 text-blue-300 text-[10px] px-1.5 py-0.5 rounded">
                OCR pending
              </div>
            )}

            {/* Hover actions */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={() => setLightbox(snap)}
                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center"
                title={t("vehicles.viewFullSize")}
              >
                <ZoomIn className="w-3.5 h-3.5 text-white" />
              </button>
              {!snap.is_primary && (
                <button
                  onClick={() => primaryMut.mutate(snap)}
                  className="w-7 h-7 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center"
                  title={t("vehicles.setAsPrimary")}
                >
                  <Star className="w-3.5 h-3.5 text-black" />
                </button>
              )}
              <button
                onClick={() => deleteMut.mutate(snap)}
                className="w-7 h-7 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center"
                title={t("common.delete")}
              >
                <Trash2 className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted-foreground">{data.total} {t("vehicles.snapshots")}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground self-center px-2">{page}/{totalPages}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-2 gap-0 bg-black/95 border-border/20">
          <div className="relative">
            {lightbox && (
              <>
                <img
                  src={lightbox.snapshot_url}
                  alt="snapshot fullsize"
                  className="w-full max-h-[80vh] object-contain rounded-lg"
                />
                <div className="mt-2 px-2 flex items-center gap-3 text-xs text-white/60">
                  {lightbox.is_primary && <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-0"><Star className="w-3 h-3 mr-1" />Primary</Badge>}
                  {lightbox.camera_id && <span className="flex items-center gap-1"><Camera className="w-3 h-3" />{lightbox.camera_id}</span>}
                  {lightbox.confidence_score != null && <span>{formatConf(lightbox.confidence_score)} {t("common.confidence").toLowerCase()}</span>}
                  {lightbox.ocr_text && <span className="font-mono">{lightbox.ocr_text}</span>}
                  <span className="ml-auto">{formatDate(lightbox.captured_at)}</span>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── VehicleDetailDialog ──────────────────────────────────────────────────────

function VehicleDetailDialog({
  vehicle, open, onClose,
}: { vehicle: Vehicle | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>("snapshots");

  const { data: eventsData } = useQuery({
    queryKey: ["vehicle-events", vehicle?.id],
    queryFn: () => vehiclesApi.events(vehicle!.id),
    enabled: !!vehicle && tab === "events",
  });

  const refreshVehicle = () => {
    qc.invalidateQueries({ queryKey: ["vehicles"] });
    qc.invalidateQueries({ queryKey: ["snapshots", vehicle?.id] });
  };

  if (!vehicle) return null;

  const tabLabels: Record<DetailTab, string> = {
    snapshots: t("vehicles.snapshotHistory"),
    events: t("vehicles.events"),
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header with primary snapshot */}
        <div className="relative h-40 shrink-0 bg-card overflow-hidden">
          <SnapshotImage
            src={vehicle.snapshot_url}
            alt={vehicle.license_plate}
            className="w-full h-full opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="font-bold text-xl font-mono text-foreground tracking-wider">
                  {vehicle.license_plate}
                </div>
                <div className="text-sm text-muted-foreground">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || t("vehicles.unknownVehicle")}
                  {vehicle.color && ` · ${vehicle.color}`}
                </div>
              </div>
              <span className={cn("text-xs px-2 py-1 rounded-full border font-medium capitalize flex items-center gap-1", STATUS_STYLES[vehicle.status])}>
                {STATUS_ICONS[vehicle.status]}{vehicle.status}
              </span>
            </div>
          </div>
        </div>

        {/* Quick stats bar */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span><span className="font-semibold text-foreground">{vehicle.total_visits}</span> {t("vehicles.visits")}</span>
          {vehicle.confidence_score != null && (
            <span>{t("vehicles.aiConf")} <span className="font-semibold text-foreground">{formatConf(vehicle.confidence_score)}</span></span>
          )}
          {vehicle.plate_region && <span>{t("vehicles.region_label")}: <span className="font-semibold text-foreground">{vehicle.plate_region}</span></span>}
          <span className="ml-auto">{t("vehicles.first")}: {formatDate(vehicle.first_seen)} · {t("vehicles.last")}: {formatDate(vehicle.last_seen)}</span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4 shrink-0 bg-background">
          {(["snapshots", "events"] as const).map((tab_key) => (
            <button
              key={tab_key}
              onClick={() => setTab(tab_key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors",
                tab === tab_key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tabLabels[tab_key]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "snapshots" && (
            <div className="space-y-4">
              <UploadZone vehicleId={vehicle.id} onSuccess={refreshVehicle} />
              <div className="border-t border-border/50 pt-4">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
                  {t("vehicles.snapshotHistory")}
                </p>
                <SnapshotGallery vehicleId={vehicle.id} onPrimaryChange={refreshVehicle} />
              </div>
            </div>
          )}

          {tab === "events" && (
            <div className="space-y-1.5">
              {!eventsData ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : eventsData.items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("vehicles.noEvents")}</p>
              ) : eventsData.items.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border/50 hover:border-border transition-colors">
                  <div>
                    <div className="text-sm font-medium capitalize">{e.event_type?.replace(/_/g, " ")}</div>
                    {e.confidence_score != null && (
                      <div className="text-xs text-muted-foreground">{formatConf(e.confidence_score)} {t("common.confidence").toLowerCase()}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Vehicle form dialog ──────────────────────────────────────────────────────

function VehicleFormDialog({
  open, onClose, vehicle,
}: { open: boolean; onClose: () => void; vehicle: Vehicle | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<VehicleForm>(vehicle ? {
    license_plate: vehicle.license_plate, make: vehicle.make ?? "", model: vehicle.model ?? "",
    color: vehicle.color ?? "", vehicle_type: vehicle.vehicle_type ?? "sedan",
    owner_name: vehicle.owner_name ?? "", plate_region: vehicle.plate_region ?? "",
    status: vehicle.status, access_type: vehicle.access_type ?? "reservation",
    notes: vehicle.notes ?? "",
  } : defaultForm);

  const mut = useMutation({
    mutationFn: () => vehicle ? vehiclesApi.update(vehicle.id, form) : vehiclesApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast({ title: vehicle ? t("vehicles.updated") : t("vehicles.created") });
      onClose();
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const f = (k: keyof VehicleForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? t("vehicles.editVehicle") : t("vehicles.addVehicle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label={t("vehicles.licensePlate")}>
            <Input value={form.license_plate} onChange={f("license_plate")} className="font-mono" placeholder="B 1234 AB" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("vehicles.make")}><Input value={form.make} onChange={f("make")} placeholder="Toyota" /></Field>
            <Field label={t("vehicles.model")}><Input value={form.model} onChange={f("model")} placeholder="Camry" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("vehicles.color")}><Input value={form.color} onChange={f("color")} placeholder="Black" /></Field>
            <Field label={t("vehicles.type")}>
              <Select value={form.vehicle_type} onValueChange={(v) => setForm((p) => ({ ...p, vehicle_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((tp) => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("vehicles.owner")}><Input value={form.owner_name} onChange={f("owner_name")} /></Field>
            <Field label={t("vehicles.region")}><Input value={form.plate_region} onChange={f("plate_region")} placeholder="Sofia" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("common.status")}>
              <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="known">{t("vehicles.status.known")}</SelectItem>
                  <SelectItem value="unknown">{t("vehicles.status.unknown")}</SelectItem>
                  <SelectItem value="blacklisted">{t("vehicles.status.blacklisted")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Access type">
              <Select
                value={form.access_type}
                onValueChange={(v) => setForm((p) => ({ ...p, access_type: v as "reservation" | "permanent" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reservation">Reservation-based (guest)</SelectItem>
                  <SelectItem value="permanent">Permanent (staff / owner)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {form.access_type === "permanent" && (
            <p className="text-xs text-muted-foreground -mt-1">
              Permanent vehicles are always allowed at the gate (unless blacklisted) — they bypass reservation windows.
            </p>
          )}
          <Field label={t("common.notes")}><Input value={form.notes} onChange={f("notes")} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!form.license_plate || mut.isPending}>
            {mut.isPending ? t("common.saving") : vehicle ? t("common.update") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VehiclesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isViewer = user?.role === "viewer";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null);
  const [detailTarget, setDetailTarget] = useState<Vehicle | null>(null);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: vehiclesApi.list,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => vehiclesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast({ title: t("vehicles.deleted") });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const blacklistMut = useMutation({
    mutationFn: ({ id, blacklisted }: { id: string; blacklisted: boolean }) =>
      vehiclesApi.blacklist(id, blacklisted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const filtered = vehicles.filter((v) => {
    const matchSearch =
      !search ||
      v.license_plate.toLowerCase().includes(search.toLowerCase()) ||
      (v.make ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (v.owner_name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <AppLayout title={t("vehicles.title")} subtitle={t("vehicles.subtitle")}>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Toolbar */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={`${t("common.search")}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="known">{t("vehicles.status.known")}</SelectItem>
              <SelectItem value="unknown">{t("vehicles.status.unknown")}</SelectItem>
              <SelectItem value="blacklisted">{t("vehicles.status.blacklisted")}</SelectItem>
            </SelectContent>
          </Select>
          {!isViewer && (
            <Button size="sm" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />{t("vehicles.addVehicle")}
            </Button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">{t("vehicles.noVehicles")}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((v) => (
              <Card key={v.id} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setDetailTarget(v)}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-muted border border-border">
                      <SnapshotImage src={v.snapshot_url} alt={v.license_plate} className="w-full h-full" />
                    </div>

                    {/* Plate + details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-foreground">{v.license_plate}</span>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1", STATUS_STYLES[v.status])}>
                          {STATUS_ICONS[v.status]}{v.status}
                        </span>
                        {v.total_visits > 0 && (
                          <span className="text-xs text-muted-foreground">{v.total_visits} {t("vehicles.visits")}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {v.make && <span>{v.make} {v.model}</span>}
                        {v.color && <span>· {v.color}</span>}
                        {v.owner_name && <span>· {v.owner_name}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {!isViewer && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                            onClick={() => { setEditTarget(v); setFormOpen(true); }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                            onClick={() => blacklistMut.mutate({ id: v.id, blacklisted: v.status !== "blacklisted" })}
                            title={v.status === "blacklisted" ? t("vehicles.unblacklist") : t("vehicles.blacklist")}>
                            <AlertTriangle className={cn("w-3.5 h-3.5", v.status === "blacklisted" ? "text-red-400" : "text-muted-foreground")} />
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                        onClick={() => setDetailTarget(v)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {!isViewer && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => deleteMut.mutate(v.id)} disabled={deleteMut.isPending}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <VehicleFormDialog open={formOpen} onClose={() => { setFormOpen(false); setEditTarget(null); }} vehicle={editTarget} />
      <VehicleDetailDialog vehicle={detailTarget} open={!!detailTarget} onClose={() => setDetailTarget(null)} />
    </AppLayout>
  );
}
