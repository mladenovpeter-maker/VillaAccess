import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { tokenStore } from "@/lib/api";
import {
  DoorOpen,
  Plus,
  Camera,
  Phone,
  MapPin,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Entrance {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  status: "active" | "inactive" | "maintenance";
  camera_count: number;
  intercom_count: number;
  gate_relay_ip: string | null;
  gate_relay_port: number | null;
  gate_relay_channel: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface EntranceForm {
  name: string;
  description: string;
  location: string;
  status: "active" | "inactive" | "maintenance";
  gate_relay_ip: string;
  gate_relay_port: string;
  notes: string;
}

const defaultForm: EntranceForm = {
  name: "",
  description: "",
  location: "",
  status: "active",
  gate_relay_ip: "",
  gate_relay_port: "",
  notes: "",
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Entrance["status"] }) {
  const { t } = useTranslation();
  if (status === "active")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15">
        <CheckCircle2 className="w-3 h-3 mr-1" /> {t("entrances.status.active")}
      </Badge>
    );
  if (status === "maintenance")
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15">
        <AlertTriangle className="w-3 h-3 mr-1" /> {t("entrances.status.maintenance")}
      </Badge>
    );
  return (
    <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15">
      <XCircle className="w-3 h-3 mr-1" /> {t("entrances.status.inactive")}
    </Badge>
  );
}

// ─── Entrance Form Dialog ─────────────────────────────────────────────────────

function EntranceDialog({
  open,
  onClose,
  entrance,
}: {
  open: boolean;
  onClose: () => void;
  entrance: Entrance | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<EntranceForm>(
    entrance
      ? {
          name: entrance.name,
          description: entrance.description ?? "",
          location: entrance.location ?? "",
          status: entrance.status,
          gate_relay_ip: entrance.gate_relay_ip ?? "",
          gate_relay_port: entrance.gate_relay_port?.toString() ?? "",
          notes: entrance.notes ?? "",
        }
      : defaultForm
  );

  const set = (k: keyof EntranceForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        location: form.location || null,
        status: form.status,
        gate_relay_ip: form.gate_relay_ip || null,
        gate_relay_port: form.gate_relay_port ? parseInt(form.gate_relay_port) : null,
        notes: form.notes || null,
      };
      if (entrance) {
        return apiFetch(`/entrances/${entrance.id}`, { method: "PUT", body: JSON.stringify(body) });
      }
      return apiFetch("/entrances", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entrances"] });
      toast({ title: entrance ? t("entrances.updated") : t("entrances.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entrance ? t("entrances.editEntrance") : t("entrances.addEntrance")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>{t("entrances.entranceName")}</Label>
              <Input
                placeholder="e.g. Main Gate"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>{t("entrances.description")}</Label>
              <Input
                placeholder="Brief description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>{t("entrances.location")}</Label>
              <Input
                placeholder="e.g. Front gate on Jl. Utama"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("common.status")}</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("entrances.status.active")}</SelectItem>
                  <SelectItem value="inactive">{t("entrances.status.inactive")}</SelectItem>
                  <SelectItem value="maintenance">{t("entrances.status.maintenance")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("entrances.gateRelayPort")}</Label>
              <Input
                type="number"
                placeholder="80"
                value={form.gate_relay_port}
                onChange={(e) => set("gate_relay_port", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>{t("entrances.gateRelayIp")}</Label>
              <Input
                placeholder="e.g. 192.168.1.50 (optional)"
                value={form.gate_relay_ip}
                onChange={(e) => set("gate_relay_ip", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>{t("common.notes")}</Label>
              <Textarea
                placeholder="Additional notes…"
                className="resize-none"
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {entrance ? t("entrances.saveChanges") : t("entrances.createEntrance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EntrancesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Entrance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entrance | null>(null);

  const { data: entrances = [], isLoading } = useQuery<Entrance[]>({
    queryKey: ["entrances"],
    queryFn: () => apiFetch("/entrances"),
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/entrances/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entrances"] });
      toast({ title: t("entrances.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const active = entrances.filter((e) => e.status === "active").length;
  const inactive = entrances.filter((e) => e.status !== "active").length;
  const totalCameras = entrances.reduce((s, e) => s + e.camera_count, 0);

  function openEdit(e: Entrance) {
    setEditTarget(e);
    setDialogOpen(true);
  }

  function openCreate() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  return (
    <AppLayout
      title={t("entrances.title")}
      subtitle={t("entrances.subtitle")}
      actions={
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          {t("entrances.addEntrance")}
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("entrances.totalEntrances"), value: entrances.length, color: "text-foreground" },
            { label: t("entrances.active"), value: active, color: "text-emerald-400" },
            { label: t("entrances.offlineMaintenance"), value: inactive, color: "text-zinc-400" },
            { label: t("entrances.camerasDeployed"), value: totalCameras, color: "text-sky-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> {t("entrances.loading")}
          </div>
        ) : entrances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <DoorOpen className="w-7 h-7 text-primary/60" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t("entrances.noEntrances")}</p>
              <p className="text-sm text-muted-foreground">{t("entrances.noEntrancesDesc")}</p>
            </div>
            <Button onClick={openCreate} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" /> {t("entrances.addFirst")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {entrances.map((entrance) => (
              <div
                key={entrance.id}
                className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 hover:border-primary/30 transition-colors"
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <DoorOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{entrance.name}</div>
                      {entrance.description && (
                        <div className="text-xs text-muted-foreground truncate">{entrance.description}</div>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={entrance.status} />
                </div>

                {/* Location */}
                {entrance.location && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{entrance.location}</span>
                  </div>
                )}

                {/* Hardware counts */}
                <div className="flex items-center gap-4 pt-1 border-t border-border">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Camera className="w-4 h-4 text-sky-400" />
                    <span className="font-medium text-foreground">{entrance.camera_count}</span>
                    <span className="text-muted-foreground text-xs">
                      {entrance.camera_count === 1 ? t("entrances.camera_one") : t("entrances.camera_other")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Phone className="w-4 h-4 text-violet-400" />
                    <span className="font-medium text-foreground">{entrance.intercom_count}</span>
                    <span className="text-muted-foreground text-xs">
                      {entrance.intercom_count === 1 ? t("entrances.intercom_one") : t("entrances.intercom_other")}
                    </span>
                  </div>
                  {entrance.gate_relay_ip && (
                    <div className="ml-auto text-xs text-muted-foreground font-mono truncate">
                      {entrance.gate_relay_ip}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => openEdit(entrance)}
                  >
                    <Pencil className="w-3.5 h-3.5" /> {t("common.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                    onClick={() => setDeleteTarget(entrance)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <EntranceDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditTarget(null);
        }}
        entrance={editTarget}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("entrances.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> {t("entrances.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("common.delete")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
