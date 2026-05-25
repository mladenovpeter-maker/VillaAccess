import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  smartLocksApi, villasApi,
  type SmartLock, type SmartLockEvent, type Villa,
} from "@/lib/api";
import {
  Plus, Pencil, Trash2, Loader2, Wifi, WifiOff, AlertCircle,
  Lock, Battery, BatteryLow, BatteryWarning, RefreshCw, History, Radio, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SmartLock["status"] }) {
  if (status === "online") return <Wifi className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "error")  return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
  return <WifiOff className="w-3.5 h-3.5 text-zinc-500" />;
}

function BatteryBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const Icon = pct < 20 ? BatteryWarning : pct < 40 ? BatteryLow : Battery;
  const color =
    pct < 20 ? "text-red-400 border-red-500/30 bg-red-500/10"
    : pct < 40 ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
    : "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] h-4 px-1 rounded border font-mono", color)}>
      <Icon className="w-3 h-3" />{pct}%
    </span>
  );
}

function formatRelative(iso: string | null, t: (k: string, opts?: any) => string): string {
  if (!iso) return t("locks.never");
  const ts = new Date(iso).getTime();
  const ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (ageSec < 60) return t("locks.secondsAgo", { n: ageSec });
  if (ageSec < 3600) return t("locks.minutesAgo", { n: Math.floor(ageSec / 60) });
  if (ageSec < 86400) return t("locks.hoursAgo", { n: Math.floor(ageSec / 3600) });
  return t("locks.daysAgo", { n: Math.floor(ageSec / 86400) });
}

// ─── Create / Edit dialog ─────────────────────────────────────────────────────

interface LockForm {
  name: string;
  villa_id: string;
  tuya_device_id: string;
}

function LockDialog({ open, onClose, target, villas, takenVillaIds }: {
  open: boolean; onClose: () => void;
  target: SmartLock | null;
  villas: Villa[];
  takenVillaIds: Set<string>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<LockForm>(
    target
      ? { name: target.name, villa_id: target.villa_id ?? "", tuya_device_id: target.tuya_device_id ?? "" }
      : { name: "", villa_id: "", tuya_device_id: "" },
  );
  const set = <K extends keyof LockForm>(k: K, v: LockForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        villa_id: form.villa_id || null,
        tuya_device_id: form.tuya_device_id.trim() || null,
        protocol: "tuya" as const,
      };
      return target ? smartLocksApi.update(target.id, body) : smartLocksApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smart-locks"] });
      toast({ title: target ? t("locks.updated") : t("locks.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("locks.error"), description: e.message, variant: "destructive" }),
  });

  const canSave = form.name.trim() && form.tuya_device_id.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target ? t("locks.edit") : t("locks.add")}</DialogTitle>
          <DialogDescription>{t("locks.dialogDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("locks.name")}</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("locks.namePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("locks.tuyaDeviceId")}</Label>
            <Input
              value={form.tuya_device_id}
              onChange={(e) => set("tuya_device_id", e.target.value)}
              placeholder="bf1234567890abcdef"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">{t("locks.tuyaDeviceIdHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("locks.villa")}</Label>
            <Select
              value={form.villa_id || "__none__"}
              onValueChange={(v) => set("villa_id", v === "__none__" ? "" : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("locks.villaUnassigned")}</SelectItem>
                {villas.map((v) => {
                  const disabled = takenVillaIds.has(v.id) && v.id !== target?.villa_id;
                  return (
                    <SelectItem key={v.id} value={v.id} disabled={disabled}>
                      {v.name}{disabled ? ` ${t("locks.villaAlreadyHasLock")}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t("locks.villaHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("locks.protocol")}</Label>
            <Input value="Tuya Cloud" disabled className="font-mono text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("locks.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {target ? t("locks.save") : t("locks.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Events dialog (recent unlocks) ───────────────────────────────────────────

function EventsDialog({ lock, onClose }: { lock: SmartLock | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["lock-events", lock?.id],
    queryFn: () => smartLocksApi.events(lock!.id, 1, 30),
    enabled: !!lock,
  });

  const records: SmartLockEvent[] = data?.records ?? [];

  return (
    <Dialog open={!!lock} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            {t("locks.recentUnlocksTitle", { name: lock?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("locks.recentUnlocksSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              {(error as Error).message}
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">{t("locks.noRecords")}</div>
          ) : (
            <div className="space-y-1.5 font-mono text-xs">
              {records.map((r, i) => {
                const ts = r.event_time != null
                  ? new Date(typeof r.event_time === "number" ? r.event_time : Date.parse(r.event_time as string))
                  : null;
                return (
                  <div key={(r.id ?? i).toString()} className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg px-3 py-2">
                    <div className="text-foreground/80">
                      {ts ? ts.toLocaleString() : "—"}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {r.event_type && <span>{r.event_type}</span>}
                      {r.event_id != null && <Badge variant="outline" className="h-4 px-1 text-[10px]">eid:{r.event_id}</Badge>}
                      {r.user_name && <span className="text-foreground">· {r.user_name}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isFetching && "animate-spin")} />
            {t("locks.refresh")}
          </Button>
          <Button onClick={onClose}>{t("locks.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lock card ────────────────────────────────────────────────────────────────

function LockCard({ lock, villaName, onEdit, onDelete, onShowEvents }: {
  lock: SmartLock;
  villaName?: string;
  onEdit: (l: SmartLock) => void;
  onDelete: (l: SmartLock) => void;
  onShowEvents: (l: SmartLock) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const statusMut = useMutation({
    mutationFn: () => smartLocksApi.status(lock.id),
    onSuccess: (r) => {
      // Backend persists; patch cache so the row updates immediately.
      qc.setQueryData<SmartLock[]>(["smart-locks"], (old) =>
        old?.map((l) => l.id === lock.id ? ({
          ...l,
          status: r.online ? "online" : "offline",
          battery_pct: r.battery_pct,
          last_seen: r.last_seen_at,
          last_status_check: new Date().toISOString(),
          last_status_latency_ms: r.latency_ms,
        }) : l),
      );
      qc.invalidateQueries({ queryKey: ["smart-locks"], refetchType: "none" });
      toast({
        title: r.online ? t("locks.statusOnline") : t("locks.statusOffline"),
        description: `${lock.name} · ${r.latency_ms}ms${r.battery_pct != null ? ` · ${t("locks.battery")} ${r.battery_pct}%` : ""}`,
        variant: r.online ? "default" : "destructive",
      });
    },
    onError: (e: any) => {
      // Backend already marks status=error in DB on failure — refetch to pick it up.
      qc.invalidateQueries({ queryKey: ["smart-locks"] });
      toast({ title: t("locks.statusFailed"), description: `${lock.name}: ${e.message}`, variant: "destructive" });
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{lock.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
              <StatusIcon status={lock.status} />
              <span className="capitalize">{lock.status}</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono border-border/60">Tuya</Badge>
              <BatteryBadge pct={lock.battery_pct} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(lock)} title={t("locks.edit")}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-400" onClick={() => onDelete(lock)} title={t("locks.delete")}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        {lock.tuya_device_id && (
          <div className="font-mono flex items-center gap-1.5 truncate">
            <Radio className="w-3 h-3 shrink-0" />{lock.tuya_device_id}
          </div>
        )}
        {villaName && (
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3 h-3" />{villaName}
          </div>
        )}
        <div>
          {t("locks.lastSeen")}: <span className="font-mono">{formatRelative(lock.last_seen, t)}</span>
          {lock.last_status_check && (
            <span className="text-muted-foreground/70"> · {t("locks.checked")} {formatRelative(lock.last_status_check, t)}</span>
          )}
          {lock.last_status_latency_ms != null && (
            <span className="text-muted-foreground/70"> · {lock.last_status_latency_ms}ms</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline" size="sm" className="h-8 text-xs gap-1.5"
          onClick={() => statusMut.mutate()} disabled={statusMut.isPending}
        >
          {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {t("locks.refreshStatus")}
        </Button>
        <Button
          variant="outline" size="sm" className="h-8 text-xs gap-1.5"
          onClick={() => onShowEvents(lock)}
        >
          <History className="w-3.5 h-3.5" />
          {t("locks.recentUnlocks")}
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LocksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SmartLock | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SmartLock | null>(null);
  const [eventsTarget, setEventsTarget] = useState<SmartLock | null>(null);

  const { data: locks = [], isLoading } = useQuery<SmartLock[]>({
    queryKey: ["smart-locks"],
    queryFn: () => smartLocksApi.list(),
    refetchInterval: 30_000,
  });

  const { data: villas = [] } = useQuery<Villa[]>({
    queryKey: ["villas"],
    queryFn: () => villasApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => smartLocksApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smart-locks"] });
      toast({ title: t("locks.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("locks.error"), description: e.message, variant: "destructive" }),
  });

  const villaMap: Record<string, string> = Object.fromEntries(villas.map((v) => [v.id, v.name]));
  const takenVillaIds = new Set(locks.filter((l) => l.villa_id).map((l) => l.villa_id as string));

  function openEdit(l: SmartLock) { setEditTarget(l); setDialogOpen(true); }
  function openCreate() { setEditTarget(null); setDialogOpen(true); }

  return (
    <AppLayout
      title={t("locks.title")}
      subtitle={t("locks.subtitle")}
      actions={
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />{t("locks.add")}
        </Button>
      }
    >
      <div className="p-6 space-y-4">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
        ) : locks.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Lock className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="text-lg font-medium text-foreground">{t("locks.noLocks")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t("locks.noLocksDesc")}</p>
            <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />{t("locks.addFirst")}</Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {locks.map((l) => (
              <LockCard
                key={l.id}
                lock={l}
                villaName={l.villa_id ? villaMap[l.villa_id] : undefined}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                onShowEvents={setEventsTarget}
              />
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <LockDialog
          key={editTarget?.id ?? "new"}
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditTarget(null); }}
          target={editTarget}
          villas={villas}
          takenVillaIds={takenVillaIds}
        />
      )}

      {eventsTarget && (
        <EventsDialog lock={eventsTarget} onClose={() => setEventsTarget(null)} />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("locks.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("locks.deleteDesc", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("locks.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("locks.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
