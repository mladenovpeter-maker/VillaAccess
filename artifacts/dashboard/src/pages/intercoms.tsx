import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { intercomsApi, entrancesApi, type Intercom, type Entrance } from "@/lib/api";
import {
  Plus, Pencil, Trash2, Loader2, Wifi, WifiOff, AlertCircle,
  DoorOpen, Activity, KeyRound, Radio, ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface IntercomForm {
  name: string;
  entrance_id: string;
  ip_address: string;
  http_port: string;
  username: string;
  password: string;
  protocol: "hikvision" | "dahua" | "sip" | "generic";
  device_type: string;
  relay_no: string;
  door_count: string;
  lock_type: string;
  pin_support: boolean;
  schedule_support: boolean;
  pin_sync_enabled: boolean;
  notes: string;
}

const defaultForm: IntercomForm = {
  name: "", entrance_id: "", ip_address: "", http_port: "80",
  username: "admin", password: "", protocol: "hikvision",
  device_type: "DS-K1T344MX-E1", relay_no: "1",
  door_count: "1", lock_type: "", pin_support: true,
  schedule_support: false, pin_sync_enabled: true, notes: "",
};

const PROTOCOL_LABELS: Record<string, string> = {
  hikvision: "Hikvision ISAPI",
  dahua:     "Dahua",
  sip:       "SIP",
  generic:   "Generic",
};

function StatusIcon({ status }: { status: Intercom["status"] }) {
  if (status === "online")  return <Wifi className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "error")   return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
  return <WifiOff className="w-3.5 h-3.5 text-zinc-500" />;
}

// ─── Form dialog ──────────────────────────────────────────────────────────────

function IntercomDialog({ open, onClose, target, entrances }: {
  open: boolean; onClose: () => void;
  target: Intercom | null; entrances: Entrance[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<IntercomForm>(
    target ? {
      name:             target.name,
      entrance_id:      target.entrance_id ?? "",
      ip_address:       target.ip_address,
      http_port:        String(target.http_port ?? 80),
      username:         target.username ?? "admin",
      password:         "",
      protocol:         target.protocol,
      device_type:      target.device_type ?? "",
      relay_no:         String(target.relay_no ?? 1),
      door_count:       String(target.door_count ?? 1),
      lock_type:        target.lock_type ?? "",
      pin_support:      target.pin_support ?? true,
      schedule_support: target.schedule_support ?? false,
      pin_sync_enabled: target.pin_sync_enabled,
      notes:            target.notes ?? "",
    } : defaultForm,
  );
  const [changePassword, setChangePassword] = useState(!target);

  const set = <K extends keyof IntercomForm>(k: K, v: IntercomForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name:             form.name,
        entrance_id:      form.entrance_id || null,
        ip_address:       form.ip_address,
        http_port:        Number(form.http_port) || 80,
        username:         form.username || "admin",
        protocol:         form.protocol,
        device_type:      form.device_type || null,
        relay_no:         Number(form.relay_no) || 1,
        door_count:       Number(form.door_count) || 1,
        lock_type:        form.lock_type || null,
        pin_support:      form.pin_support,
        schedule_support: form.schedule_support,
        pin_sync_enabled: form.pin_sync_enabled,
        notes:            form.notes || null,
      };
      if (!target || changePassword) body.password = form.password;
      return target
        ? intercomsApi.update(target.id, body as any)
        : intercomsApi.create(body as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercoms"] });
      toast({ title: target ? t("intercoms.updated") : t("intercoms.created") });
      onClose();
    },
    onError: (e: Error) => {
      console.error("[intercoms] save failed", e);
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    },
  });

  const canSave = form.name.trim() && form.ip_address.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target ? t("intercoms.editIntercom") : t("intercoms.addIntercom")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">Connection</legend>
            <div className="space-y-1.5">
              <Label>{t("intercoms.name")}</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Main Gate Terminal" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("intercoms.ipAddress")}</Label>
                <Input value={form.ip_address} onChange={(e) => set("ip_address", e.target.value)} placeholder="192.168.1.110" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("intercoms.httpPort")}</Label>
                <Input type="number" value={form.http_port} onChange={(e) => set("http_port", e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>{t("intercoms.username")}</Label>
                <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="admin" />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("intercoms.password")}{" "}
                  {target && !changePassword && (
                    <button type="button" onClick={() => setChangePassword(true)} className="text-primary hover:underline text-xs">(change)</button>
                  )}
                </Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  disabled={!!target && !changePassword}
                  placeholder={target && !changePassword ? "••••••••" : "Device password"}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 border border-border rounded-lg p-3">
            <legend className="text-xs text-muted-foreground px-1">Device</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>{t("intercoms.protocol")}</Label>
                <Select value={form.protocol} onValueChange={(v) => set("protocol", v as IntercomForm["protocol"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hikvision">Hikvision ISAPI</SelectItem>
                    <SelectItem value="dahua">Dahua</SelectItem>
                    <SelectItem value="sip">SIP</SelectItem>
                    <SelectItem value="generic">Generic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("intercoms.relayNo")}</Label>
                <Input type="number" min={1} value={form.relay_no} onChange={(e) => set("relay_no", e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>{t("intercoms.deviceType")}</Label>
                <Input value={form.device_type} onChange={(e) => set("device_type", e.target.value)} placeholder={t("intercoms.deviceTypePlaceholder")} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("intercoms.doorCount")}</Label>
                <Input type="number" min={1} max={8} value={form.door_count} onChange={(e) => set("door_count", e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("intercoms.lockType")}</Label>
              <Input value={form.lock_type} onChange={(e) => set("lock_type", e.target.value)} placeholder={t("intercoms.lockTypePlaceholder")} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("intercoms.entrance")}</Label>
              <Select value={form.entrance_id || "__none__"} onValueChange={(v) => set("entrance_id", v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("intercoms.noEntrance")}</SelectItem>
                  {entrances.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={form.pin_support} onChange={(e) => set("pin_support", e.target.checked)} className="accent-primary" />
                {t("intercoms.pinSupport")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={form.schedule_support} onChange={(e) => set("schedule_support", e.target.checked)} className="accent-primary" />
                {t("intercoms.scheduleSupport")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={form.pin_sync_enabled} onChange={(e) => set("pin_sync_enabled", e.target.checked)} className="accent-primary" />
                {t("intercoms.pinSyncEnabled")}
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>{t("intercoms.notes")}</Label>
              <Textarea
                rows={2}
                className="resize-none"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {target ? t("entrances.saveChanges") : t("intercoms.addIntercom")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Intercom card ────────────────────────────────────────────────────────────

function IntercomCard({ intercom, entranceName, onEdit, onDelete }: {
  intercom: Intercom; entranceName?: string;
  onEdit: (i: Intercom) => void; onDelete: (i: Intercom) => void;
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Patch a single intercom's fields in the cached list immediately, without
  // waiting for a background refetch. Prevents stale "offline/failed" after a
  // successful server-side operation.
  const patchCache = (patch: Partial<Intercom>) =>
    qc.setQueryData<Intercom[]>(["intercoms"], (old) =>
      old?.map((ic) => (ic.id === intercom.id ? { ...ic, ...patch } : ic)),
    );

  const openMut = useMutation({
    mutationFn: () => intercomsApi.open(intercom.id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["intercoms"] });
      toast({
        title: r?.success ? t("intercoms.doorOpened") : t("intercoms.doorFailed"),
        description: r?.close_warning
          ? `${intercom.name} · relay closed (${r.close_warning})`
          : intercom.name,
        variant: r?.success ? "default" : "destructive",
      });
    },
    // api.request throws on 502; e.message = detail field = actual device error
    onError: (e: any) => toast({
      title: t("intercoms.doorFailed"),
      description: `${intercom.name}: ${e.message}`,
      variant: "destructive",
    }),
  });

  const pingMut = useMutation({
    mutationFn: () => intercomsApi.testConnectivity(intercom.id),
    onSuccess: (r: any) => {
      // Backend returns the full updated intercom from DB — use it directly.
      // This is authoritative and eliminates all optimistic-update race conditions.
      if (r?.intercom) {
        qc.setQueryData<Intercom[]>(["intercoms"], (old) =>
          old?.map((ic) => (ic.id === r.intercom.id ? r.intercom : ic)),
        );
      } else {
        // Fallback: partial patch if backend didn't return the full record
        patchCache({
          status: r?.success ? "online" : "offline",
          last_status_check: new Date().toISOString(),
          ...(r?.latency_ms != null ? { last_status_latency_ms: r.latency_ms } : {}),
        } as any);
      }
      // Mark stale so the next natural 30s poll syncs; no immediate refetch
      // that could race with the cache update we just applied.
      qc.invalidateQueries({ queryKey: ["intercoms"], refetchType: "none" });
      toast({
        title: r?.success ? t("intercoms.connectivityOk") : t("intercoms.connectivityFailed"),
        description: r?.device_name
          ? `${r.device_name} · ${r.latency_ms}ms`
          : r?.error ?? `${r?.latency_ms ?? "?"}ms`,
        variant: r?.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: () => intercomsApi.testPinSync(intercom.id),
    onSuccess: (r: any) => {
      // Same pattern: use the authoritative intercom record from DB.
      if (r?.intercom) {
        qc.setQueryData<Intercom[]>(["intercoms"], (old) =>
          old?.map((ic) => (ic.id === r.intercom.id ? r.intercom : ic)),
        );
      } else {
        patchCache({
          last_sync_status: r?.success ? "success" : "failed",
          last_sync_at: new Date().toISOString(),
        } as any);
      }
      qc.invalidateQueries({ queryKey: ["intercoms"], refetchType: "none" });
      toast({
        title: r?.success ? t("intercoms.syncOk") : t("intercoms.syncFailed"),
        description: r?.error ?? `${r?.latency_ms ?? "?"}ms`,
        variant: r?.success ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const anyLoading = openMut.isPending || pingMut.isPending || syncMut.isPending;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{intercom.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
              <StatusIcon status={intercom.status} />
              <span className="capitalize">{intercom.status}</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono border-border/60">
                {PROTOCOL_LABELS[intercom.protocol] ?? intercom.protocol}
              </Badge>
              {intercom.pin_sync_enabled && (
                <Badge className="text-[10px] h-4 px-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">PIN</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(intercom)} title="Edit">
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-400" onClick={() => onDelete(intercom)} title="Delete">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <div className="font-mono flex items-center gap-1.5"><Radio className="w-3 h-3" />{intercom.ip_address}:{intercom.http_port}</div>
        {intercom.device_type && <div className="font-mono">{intercom.device_type} · door {intercom.relay_no}{intercom.door_count > 1 ? ` / ${intercom.door_count}` : ""}</div>}
        {intercom.lock_type && <div className="font-mono text-muted-foreground/70">{intercom.lock_type}</div>}
        {entranceName && <div>📍 {entranceName}</div>}
        {intercom.last_sync_at && (
          <div>
            Last sync: <span className="font-mono">{new Date(intercom.last_sync_at).toLocaleString()}</span>
            {intercom.last_sync_status && <span className="ml-1 text-muted-foreground/70">({intercom.last_sync_status})</span>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => openMut.mutate()} disabled={anyLoading}>
          {openMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DoorOpen className="w-3.5 h-3.5" />}
          {openMut.isPending ? t("intercoms.openingDoor") : t("intercoms.openDoor")}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => pingMut.mutate()} disabled={anyLoading}>
          {pingMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          {t("intercoms.testConnectivity")}
        </Button>
        {intercom.protocol === "hikvision" && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => syncMut.mutate()} disabled={anyLoading}>
            {syncMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            {t("intercoms.testPinSync")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntercomsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Intercom | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Intercom | null>(null);

  const { data: intercoms = [], isLoading } = useQuery<Intercom[]>({
    queryKey: ["intercoms"],
    queryFn: () => intercomsApi.list(),
    refetchInterval: 30_000,
  });

  const { data: entrances = [] } = useQuery<Entrance[]>({
    queryKey: ["entrances"],
    queryFn: () => entrancesApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => intercomsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercoms"] });
      toast({ title: t("intercoms.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => {
      console.error("[intercoms] save failed", e);
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    },
  });

  function openEdit(i: Intercom) { setEditTarget(i); setDialogOpen(true); }
  function openCreate() { setEditTarget(null); setDialogOpen(true); }

  const entranceMap: Record<string, string> = Object.fromEntries(entrances.map((e) => [e.id, e.name]));

  return (
    <AppLayout
      title={t("intercoms.title")}
      subtitle={t("intercoms.subtitle")}
      actions={
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />{t("intercoms.addIntercom")}
        </Button>
      }
    >
      <div className="p-6 space-y-4">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
        ) : intercoms.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="text-lg font-medium text-foreground">{t("intercoms.noIntercoms")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t("intercoms.noIntercomsDesc")}</p>
            <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />{t("intercoms.addFirst")}</Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {intercoms.map((ic) => (
              <IntercomCard
                key={ic.id}
                intercom={ic}
                entranceName={ic.entrance_id ? entranceMap[ic.entrance_id] : undefined}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <IntercomDialog
          key={dialogOpen ? (editTarget?.id ?? "new") : "closed"}
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditTarget(null); }}
          target={editTarget}
          entrances={entrances}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("intercoms.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.name}</span> {t("intercoms.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
