import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  camerasApi, entrancesApi,
  type Camera, type CameraStatusResult, type CameraActionResult,
} from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Camera as CameraIcon, Wifi, WifiOff, AlertCircle, RefreshCw,
  GitMerge, ImageIcon, Activity, ChevronDown, ChevronUp,
  Clock, Cpu, Radio, Plus, Pencil, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_KEYS = {
  online:  { cls: "bg-green-500/15 text-green-400 border-green-500/20",   Icon: Wifi        },
  offline: { cls: "bg-red-500/15 text-red-400 border-red-500/20",         Icon: WifiOff     },
  error:   { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20", Icon: AlertCircle },
};

const PROTOCOL_LABELS: Record<string, string> = {
  hikvision: "Hikvision ISAPI",
  dahua:     "Dahua HTTP",
  onvif:     "ONVIF",
  rtsp:      "RTSP",
};

// ─── Form types ───────────────────────────────────────────────────────────────

interface CameraFormData {
  name: string;
  ip_address: string;
  http_port: string;
  username: string;
  password: string;
  protocol: string;
  channel_no: string;
  entrance_id: string;
  gate_no: string;
  // ANPR / OCR (V1)
  ocr_enabled: boolean;
  polling_interval_ms: string;
  ocr_min_confidence: string;
  anpr_cooldown_seconds: string;
  // Fuzzy / partial plate matching
  allow_partial_match: boolean;
  partial_match_threshold: string;
  partial_min_confidence: string;
  min_matching_digits: string;
}

const defaultCameraForm: CameraFormData = {
  name: "", ip_address: "", http_port: "80", username: "admin",
  password: "", protocol: "hikvision", channel_no: "1",
  entrance_id: "", gate_no: "1",
  ocr_enabled: false, polling_interval_ms: "1500",
  ocr_min_confidence: "70", anpr_cooldown_seconds: "30",
  allow_partial_match: false, partial_match_threshold: "85",
  partial_min_confidence: "50", min_matching_digits: "4",
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

// ─── Action button ─────────────────────────────────────────────────────────────

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

// ─── Camera form dialog ────────────────────────────────────────────────────────

function CameraFormDialog({
  open, onClose, editTarget, entrances,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: Camera | null;
  entrances: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<CameraFormData>(defaultCameraForm);
  const [changePassword, setChangePassword] = useState(false);

  // Reset form whenever the dialog opens (or the edit target changes).
  // NOTE: must be an effect — using a useState lazy initializer here only
  // runs once on mount and never resets the form on subsequent opens.
  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setForm({
        name:        editTarget.name,
        ip_address:  editTarget.ip_address,
        http_port:   String(editTarget.http_port ?? 80),
        username:    editTarget.username ?? "admin",
        password:    "",
        protocol:    editTarget.protocol ?? "hikvision",
        channel_no:  String(editTarget.channel_no ?? 1),
        entrance_id: editTarget.entrance_id ?? "",
        gate_no:     String(editTarget.gate_no ?? 1),
        ocr_enabled:           editTarget.ocr_enabled ?? false,
        polling_interval_ms:   String(editTarget.polling_interval_ms ?? 1500),
        ocr_min_confidence:    String(editTarget.ocr_min_confidence ?? 70),
        anpr_cooldown_seconds: String(editTarget.anpr_cooldown_seconds ?? 30),
        allow_partial_match:     editTarget.allow_partial_match ?? false,
        partial_match_threshold: String(editTarget.partial_match_threshold ?? 85),
        partial_min_confidence:  String(editTarget.partial_min_confidence ?? 50),
        min_matching_digits:     String(editTarget.min_matching_digits ?? 4),
      });
      setChangePassword(false);
    } else {
      setForm(defaultCameraForm);
      setChangePassword(true);
    }
  }, [open, editTarget]);

  const createMut = useMutation({
    mutationFn: (data: any) => camerasApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({ title: "Camera added" });
      onClose();
    },
    onError: (e: any) => {
      // Surface the real error in the console so it can never be silently swallowed.
      console.error("[cameras] create failed", e);
      toast({
        title: "Error adding camera",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => camerasApi.update(editTarget!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({ title: "Camera updated" });
      onClose();
    },
    onError: (e: any) => {
      console.error("[cameras] update failed", e);
      toast({
        title: "Error saving camera",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    },
  });

  function handleSave() {
    try {
      const payload: Record<string, unknown> = {
        name:        form.name.trim(),
        ip_address:  form.ip_address.trim(),
        http_port:   Number(form.http_port) || 80,
        username:    form.username.trim() || "admin",
        protocol:    form.protocol,
        channel_no:  Number(form.channel_no) || 1,
        entrance_id: form.entrance_id || null,
        gate_no:     Number(form.gate_no) || 1,
        ocr_enabled:           form.ocr_enabled,
        polling_interval_ms:   Math.max(500, Number(form.polling_interval_ms) || 1500),
        ocr_min_confidence:    Math.min(100, Math.max(0, Number(form.ocr_min_confidence) || 70)),
        anpr_cooldown_seconds: Math.max(1, Number(form.anpr_cooldown_seconds) || 30),
        allow_partial_match:     form.allow_partial_match,
        partial_match_threshold: Math.min(100, Math.max(0, Number(form.partial_match_threshold) || 85)),
        partial_min_confidence:  Math.min(100, Math.max(0, Number(form.partial_min_confidence) || 50)),
        min_matching_digits:     Math.max(0, Number(form.min_matching_digits) || 4),
      };
      if (!editTarget || changePassword) {
        payload.password = form.password;
      }
      if (editTarget) updateMut.mutate(payload);
      else createMut.mutate(payload);
    } catch (err: any) {
      // Defensive: if anything throws synchronously while building the payload,
      // show it instead of leaving the dialog locked.
      console.error("[cameras] handleSave threw", err);
      toast({
        title: "Error",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  const loading = createMut.isPending || updateMut.isPending;
  const canSave = form.name.trim() && form.ip_address.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editTarget ? "Edit Camera" : "Add Camera"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic */}
          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">Connection</legend>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Gate A — Hikvision DS-2CD" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs text-muted-foreground">IP Address *</label>
                <Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">HTTP Port</label>
                <Input type="number" value={form.http_port} onChange={(e) => setForm({ ...form, http_port: e.target.value })} className="font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Username</label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Password {editTarget && !changePassword && <button type="button" onClick={() => setChangePassword(true)} className="text-primary hover:underline">(change)</button>}
                </label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  disabled={!!editTarget && !changePassword}
                  placeholder={editTarget && !changePassword ? "••••••••" : "Camera password"}
                />
              </div>
            </div>
          </fieldset>

          {/* Protocol + channel */}
          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">Protocol</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Protocol</label>
                <select
                  value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="hikvision">Hikvision ISAPI</option>
                  <option value="dahua">Dahua HTTP</option>
                  <option value="onvif">ONVIF</option>
                  <option value="rtsp">RTSP only</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Channel No.</label>
                <Input type="number" value={form.channel_no} onChange={(e) => setForm({ ...form, channel_no: e.target.value })} className="font-mono" min={1} />
              </div>
            </div>
          </fieldset>

          {/* Location */}
          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">Location &amp; Relay</legend>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Entrance</label>
              <select
                value={form.entrance_id}
                onChange={(e) => setForm({ ...form, entrance_id: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">— None —</option>
                {entrances.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Gate relay output no.</label>
              <Input type="number" value={form.gate_no} onChange={(e) => setForm({ ...form, gate_no: e.target.value })} className="font-mono" min={1} />
              <p className="text-[10px] text-muted-foreground/70">
                On-board I/O alarm output number used to pulse the gate.
              </p>
            </div>
          </fieldset>

          {/* ANPR / OCR (V1) */}
          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">ANPR / Plate recognition</legend>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ocr_enabled}
                onChange={(e) => setForm({ ...form, ocr_enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm">Enable OCR polling on this camera</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Poll interval (ms)</label>
                <Input
                  type="number"
                  value={form.polling_interval_ms}
                  onChange={(e) => setForm({ ...form, polling_interval_ms: e.target.value })}
                  className="font-mono"
                  min={500}
                  step={100}
                  disabled={!form.ocr_enabled}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Min confidence</label>
                <Input
                  type="number"
                  value={form.ocr_min_confidence}
                  onChange={(e) => setForm({ ...form, ocr_min_confidence: e.target.value })}
                  className="font-mono"
                  min={0}
                  max={100}
                  disabled={!form.ocr_enabled}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Cooldown (s)</label>
                <Input
                  type="number"
                  value={form.anpr_cooldown_seconds}
                  onChange={(e) => setForm({ ...form, anpr_cooldown_seconds: e.target.value })}
                  className="font-mono"
                  min={1}
                  disabled={!form.ocr_enabled}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Worker polls the snapshot endpoint, runs OCR, and triggers this camera's gate relay
              when a known/allowed plate is detected. Snapshots are processed in memory only.
            </p>

            {/* Fuzzy / partial plate matching — additive, default OFF */}
            <div className="mt-1 border-t border-border/60 pt-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.allow_partial_match}
                  onChange={(e) => setForm({ ...form, allow_partial_match: e.target.checked })}
                  className="h-4 w-4"
                  disabled={!form.ocr_enabled}
                />
                <span className="text-sm">Allow partial plate match</span>
              </label>
              <p className="text-[10px] text-muted-foreground/70 -mt-2">
                When OCR misses one or two trailing characters (e.g. "CA3477M" vs reservation
                "CA3477MM"), accept the closest known plate as long as it passes all three gates
                below. Exact matches always win; partial matching only runs when exact fails.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Similarity ≥ (%)</label>
                  <Input
                    type="number"
                    value={form.partial_match_threshold}
                    onChange={(e) => setForm({ ...form, partial_match_threshold: e.target.value })}
                    className="font-mono"
                    min={0}
                    max={100}
                    disabled={!form.ocr_enabled || !form.allow_partial_match}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">OCR conf ≥ (%)</label>
                  <Input
                    type="number"
                    value={form.partial_min_confidence}
                    onChange={(e) => setForm({ ...form, partial_min_confidence: e.target.value })}
                    className="font-mono"
                    min={0}
                    max={100}
                    disabled={!form.ocr_enabled || !form.allow_partial_match}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Min matching digits</label>
                  <Input
                    type="number"
                    value={form.min_matching_digits}
                    onChange={(e) => setForm({ ...form, min_matching_digits: e.target.value })}
                    className="font-mono"
                    min={0}
                    disabled={!form.ocr_enabled || !form.allow_partial_match}
                  />
                </div>
              </div>
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || !canSave}>
            {loading ? "Saving…" : editTarget ? "Save Changes" : "Add Camera"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CameraCard ───────────────────────────────────────────────────────────────

function CameraCard({
  camera, canWrite,
  onEdit, onDelete,
}: {
  camera: Camera;
  canWrite: boolean;
  onEdit: (c: Camera) => void;
  onDelete: (c: Camera) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Hydrate the live preview from localStorage on mount, so the last captured
  // base64 snapshot persists across navigation and full page reloads — even
  // when /api/uploads/* serving is flaky behind nginx/proxies.
  const cacheKey = `cam-snap:${camera.id}`;
  const [liveSnap, setLiveSnap] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { dataUrl?: string };
      return parsed.dataUrl ?? null;
    } catch {
      return null;
    }
  });

  // If the camera object changes (e.g. refetch shows a newer last_snapshot
  // than what we cached), drop our stale cache so we fall back to snapshot_url.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { ts?: string };
      if (
        camera.last_snapshot &&
        parsed.ts &&
        new Date(camera.last_snapshot).getTime() > new Date(parsed.ts).getTime()
      ) {
        window.localStorage.removeItem(cacheKey);
        setLiveSnap(null);
      }
    } catch {
      /* ignore */
    }
  }, [cacheKey, camera.last_snapshot]);

  const cfg = STATUS_KEYS[camera.status as keyof typeof STATUS_KEYS] ?? STATUS_KEYS.offline;
  const StatusIcon = cfg.Icon;
  const statusLabel = t(`cameras.${camera.status as "online" | "offline" | "error"}`);

  const snapMut = useMutation({
    mutationFn: () => camerasApi.snapshot(camera.id),
    onSuccess: (r: CameraActionResult) => {
      if (r.success && (r.snapshot_base64 || r.snapshot_url)) {
        // Prefer inline base64 data URL — bypasses nginx, static routing,
        // SPA fallback, Safari edge cases, CORS, and mixed-content issues.
        const next = r.snapshot_base64 ?? r.snapshot_url ?? null;
        setLiveSnap(next);

        // Persist the base64 preview so it survives navigation and reload.
        // (We only cache data URLs — never the http(s) snapshot_url, which
        // doesn't need a cache and would just bloat localStorage.)
        if (typeof window !== "undefined" && r.snapshot_base64) {
          try {
            window.localStorage.setItem(
              cacheKey,
              JSON.stringify({
                dataUrl: r.snapshot_base64,
                ts: r.captured_at ?? new Date().toISOString(),
              }),
            );
          } catch {
            // Quota exceeded — drop oldest entries and retry once.
            try {
              for (let i = window.localStorage.length - 1; i >= 0; i--) {
                const k = window.localStorage.key(i);
                if (k && k.startsWith("cam-snap:") && k !== cacheKey) {
                  window.localStorage.removeItem(k);
                }
              }
              window.localStorage.setItem(
                cacheKey,
                JSON.stringify({
                  dataUrl: r.snapshot_base64,
                  ts: r.captured_at ?? new Date().toISOString(),
                }),
              );
            } catch {
              /* still over quota — preview is in-memory only this session */
            }
          }
        }

        toast({ title: t("cameras.snapshotCaptured"), description: camera.name });
      } else {
        toast({ title: t("cameras.snapshotFailed"), description: r.error ?? "Camera did not respond", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

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
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const gateMut = useMutation({
    mutationFn: () => camerasApi.gate(camera.id),
    onSuccess: (r: CameraActionResult) => {
      toast({
        title: r.success ? t("cameras.gateOpened") : t("cameras.gateFailed"),
        description: r.success
          ? `${camera.name} — relay ${r.target_no} (${r.mode})`
          : r.error ?? "No response from camera",
        variant: r.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: t("cameras.gateError"), description: e.message, variant: "destructive" }),
  });

  const displaySnap = liveSnap ?? camera.snapshot_url;
  const anyLoading = snapMut.isPending || statusMut.isPending || gateMut.isPending;

  return (
    <Card className={cn(
      "overflow-hidden transition-all",
      camera.status === "online" ? "hover:border-primary/40" : "opacity-80",
    )}>
      {/* Snapshot / feed area */}
      <div className="relative bg-black/40 aspect-video flex items-center justify-center border-b border-border overflow-hidden">
        {displaySnap ? (
          <img src={displaySnap} alt={camera.name} className="w-full h-full object-cover" key={displaySnap} />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <CameraIcon className="w-8 h-8" />
            <span className="text-xs">{camera.status === "online" ? t("cameras.noSnapshot") : t("cameras.noSignal")}</span>
          </div>
        )}

        {/* Status badge */}
        <div className={cn("absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border font-medium", cfg.cls)}>
          <StatusIcon className="w-3 h-3" />
          {statusLabel}
        </div>

        {camera.status === "online" && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-red-600/80 text-white font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />REC
          </div>
        )}

        {camera.last_status_latency_ms != null && camera.status === "online" && (
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
            {formatLatency(camera.last_status_latency_ms)}
          </div>
        )}

        {/* Edit / Delete overlay — top-left when offline, only for write access */}
        {canWrite && (
          <div className={cn(
            "absolute bottom-2 left-2 flex gap-1",
            camera.status === "online" && "top-2 left-auto right-24",
          )}>
            <button
              onClick={() => onEdit(camera)}
              className="h-6 w-6 flex items-center justify-center rounded bg-black/60 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              title="Edit camera"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDelete(camera)}
              className="h-6 w-6 flex items-center justify-center rounded bg-black/60 text-white/70 hover:text-red-400 hover:bg-black/80 transition-colors"
              title="Delete camera"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-3">
        {/* Name + protocol */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm text-foreground truncate">{camera.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
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
              {t("cameras.lastSnap")} {formatTime(camera.last_snapshot)}
            </div>
          )}
          {camera.model && <div className="flex items-center gap-1.5"><Cpu className="w-3 h-3" />{camera.model}</div>}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5">
          <ActionButton icon={ImageIcon} label={t("cameras.snapshot")} onClick={() => snapMut.mutate()} loading={snapMut.isPending} disabled={anyLoading} />
          <ActionButton icon={Activity} label={t("cameras.ping")} onClick={() => statusMut.mutate()} loading={statusMut.isPending} disabled={anyLoading} />
          <ActionButton
            icon={GitMerge}
            label={gateMut.isPending ? t("cameras.gateOpening") : t("cameras.gate")}
            onClick={() => gateMut.mutate()}
            loading={gateMut.isPending}
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
              {t("cameras.deviceInfo")}
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

        <div className="text-[10px] text-muted-foreground/50">
          I/O relay · Output {camera.gate_no} (gate)
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ canWrite, onAdd }: { canWrite: boolean; onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="py-16 text-center space-y-4">
        <CameraIcon className="w-12 h-12 mx-auto text-muted-foreground/30" />
        <div>
          <p className="text-muted-foreground font-medium">No cameras configured</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Add your Hikvision (or other) cameras to start monitoring entrances.
          </p>
        </div>
        {canWrite && (
          <Button onClick={onAdd} className="gap-2">
            <Plus className="w-4 h-4" />Add First Camera
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CamerasPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = true;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Camera | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Camera | null>(null);

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ["cameras"],
    queryFn: camerasApi.list,
    refetchInterval: 30_000,
  });

  const { data: entrances = [] } = useQuery({
    queryKey: ["entrances"],
    queryFn: entrancesApi.list,
  });

  const online  = cameras.filter((c) => c.status === "online").length;
  const offline = cameras.filter((c) => c.status === "offline").length;
  const error   = cameras.filter((c) => c.status === "error").length;

  const pingAllMut = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(cameras.map((c) => camerasApi.status(c.id)));
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({ title: t("cameras.statusRefresh"), description: t("cameras.camerasChecked", { count: cameras.length }) });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => camerasApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cameras"] });
      toast({ title: "Camera removed" });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openAdd() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(c: Camera) { setEditTarget(c); setDialogOpen(true); }
  function closeDialog() { setDialogOpen(false); setEditTarget(null); }

  return (
    <AppLayout
      title={t("cameras.title")}
      subtitle={`${cameras.length} ${t("cameras.total")} · ${online} ${t("cameras.online")}`}
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => pingAllMut.mutate()}
            disabled={pingAllMut.isPending || cameras.length === 0}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", pingAllMut.isPending && "animate-spin")} />
            {t("cameras.pingAll")}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={openAdd} className="gap-1.5">
              <Plus className="w-4 h-4" />Add Camera
            </Button>
          )}
        </div>
      }
    >
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Summary stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-muted-foreground">{online} {t("cameras.online")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-muted-foreground">{offline} {t("cameras.offline")}</span>
          </div>
          {error > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-muted-foreground">{error} {t("cameras.error")}</span>
            </div>
          )}
          <span className="text-muted-foreground">{cameras.length} {t("cameras.total")}</span>
        </div>

        {/* Camera grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : cameras.length === 0 ? (
          <EmptyState canWrite={canWrite} onAdd={openAdd} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map((c) => (
              <CameraCard
                key={c.id}
                camera={c}
                canWrite={canWrite}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}

        {/* Protocol legend */}
        <div className="text-xs text-muted-foreground border border-border rounded-lg px-4 py-3 bg-muted/20 space-y-1">
          <div className="font-medium text-foreground/70 mb-1.5">{t("cameras.supportedProtocols")}</div>
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

      {/* Add / Edit dialog — keyed so internal form state is always fresh */}
      <CameraFormDialog
        key={dialogOpen ? (editTarget?.id ?? "new") : "closed"}
        open={dialogOpen}
        onClose={closeDialog}
        editTarget={editTarget}
        entrances={entrances}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove camera?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.ip_address}) will be permanently removed from the system. Existing access logs and events that referenced this camera will be retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Camera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
