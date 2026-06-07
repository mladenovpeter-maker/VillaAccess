import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { entrancesApi, type Entrance, api } from "@/lib/api";
import {
  DoorOpen, Plus, Camera, Phone, Pencil, Trash2,
  CheckCircle2, XCircle, Loader2, Zap, Activity, ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccessLevel = "public" | "restricted" | "admin_only";

interface EntranceCamera {
  id: string; name: string; ip_address: string; protocol: string;
  status: "online" | "offline" | "error";
}

interface EntranceIntercom {
  id: string; name: string; ip_address: string; protocol: string;
  status: "online" | "offline" | "error";
}

interface EntranceEvent {
  id: string; timestamp: string; event_type: string; status: string;
  license_plate: string | null;
}

interface EntranceForm {
  name: string;
  access_level: AccessLevel;
  description: string;
  active: boolean;
}

const defaultForm: EntranceForm = {
  name: "", access_level: "public", description: "", active: true,
};

// ─── Status badges ────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15">
      <CheckCircle2 className="w-3 h-3 mr-1" />Active
    </Badge>
  ) : (
    <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15">
      <XCircle className="w-3 h-3 mr-1" />Inactive
    </Badge>
  );
}

function AccessLevelBadge({ level }: { level: AccessLevel }) {
  const map: Record<AccessLevel, { label: string; cls: string }> = {
    public:     { label: "Public",     cls: "bg-sky-500/15 text-sky-400 border-sky-500/20 hover:bg-sky-500/15" },
    restricted: { label: "Restricted", cls: "bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15" },
    admin_only: { label: "Admin Only", cls: "bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15" },
  };
  const { label, cls } = map[level] ?? map.public;
  return (
    <Badge className={`text-xs ${cls}`}>
      <ShieldCheck className="w-3 h-3 mr-1" />{label}
    </Badge>
  );
}

function DeviceStatusDot({ status }: { status: string }) {
  if (status === "online") return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (status === "error") return <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />;
}

function EventStatusBadge({ status }: { status: string }) {
  if (status === "allowed") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15 text-xs">Allowed</Badge>;
  if (status === "denied")  return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15 text-xs">Denied</Badge>;
  return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15 text-xs">{status}</Badge>;
}

// ─── Entrance Form Dialog ─────────────────────────────────────────────────────

function EntranceDialog({ open, onClose, entrance }: {
  open: boolean; onClose: () => void; entrance: Entrance | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<EntranceForm>(defaultForm);

  useEffect(() => {
    if (!open) return;
    setForm(entrance ? {
      name:         entrance.name,
      access_level: entrance.access_level ?? "public",
      description:  entrance.description ?? "",
      active:       entrance.active,
    } : defaultForm);
  }, [open, entrance]);

  const set = <K extends keyof EntranceForm>(k: K, v: EntranceForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name:         form.name,
        access_level: form.access_level,
        description:  form.description || null,
        active:       form.active,
      };
      return entrance
        ? entrancesApi.update(entrance.id, body as any)
        : entrancesApi.create(body as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entrances"] });
      toast({ title: entrance ? t("entrances.updated") : t("entrances.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const accessLevelOptions: { value: AccessLevel; label: string }[] = [
    { value: "public",     label: t("entrances.accessLevelPublic") },
    { value: "restricted", label: t("entrances.accessLevelRestricted") },
    { value: "admin_only", label: t("entrances.accessLevelAdminOnly") },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entrance ? t("entrances.editEntrance") : t("entrances.addEntrance")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("entrances.entranceName")}</Label>
            <Input placeholder="e.g. Main Gate" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("entrances.accessLevel")}</Label>
            <div className="flex flex-col gap-2">
              {accessLevelOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    form.access_level === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="access_level"
                    value={opt.value}
                    checked={form.access_level === opt.value}
                    onChange={() => set("access_level", opt.value)}
                    className="accent-primary"
                  />
                  <div>
                    <AccessLevelBadge level={opt.value} />
                  </div>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("entrances.accessLevelHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("entrances.description")}</Label>
            <Textarea
              placeholder="Brief description (optional)"
              className="resize-none" rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="accent-primary"
            />
            {t("entrances.active")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {entrance ? t("entrances.saveChanges") : t("entrances.createEntrance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Entrance Detail Sheet ────────────────────────────────────────────────────

function EntranceDetailSheet({ entrance, onClose, onEdit }: {
  entrance: Entrance | null;
  onClose: () => void; onEdit: (e: Entrance) => void;
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [testingGate, setTestingGate] = useState<string | null>(null);

  const { data: cameras = [], isLoading: camLoading } = useQuery<EntranceCamera[]>({
    queryKey: ["entrance-cameras", entrance?.id],
    queryFn: () => api.get<EntranceCamera[]>(`/entrances/${entrance!.id}/cameras`),
    enabled: !!entrance,
  });

  const { data: intercoms = [], isLoading: intLoading } = useQuery<EntranceIntercom[]>({
    queryKey: ["entrance-intercoms", entrance?.id],
    queryFn: () => api.get<EntranceIntercom[]>(`/entrances/${entrance!.id}/intercoms`),
    enabled: !!entrance,
  });

  const { data: eventsData, isLoading: evLoading } = useQuery<{ items: EntranceEvent[] }>({
    queryKey: ["entrance-events", entrance?.id],
    queryFn: () => api.get<{ items: EntranceEvent[] }>(`/access/events?entrance_id=${entrance!.id}&page_size=10`),
    enabled: !!entrance,
    refetchInterval: 15_000,
  });
  const events = eventsData?.items ?? [];

  async function testGate(cameraId: string) {
    setTestingGate(cameraId);
    try {
      const res: any = await api.post(`/cameras/${cameraId}/gate`, {});
      toast({ title: res?.success ? t("cameras.gateOpened") : t("cameras.gateFailed") });
    } catch (e: any) {
      toast({ title: t("cameras.gateError"), description: e.message, variant: "destructive" });
    } finally {
      setTestingGate(null);
    }
  }

  if (!entrance) return null;

  return (
    <Sheet open={!!entrance} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <DoorOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base">{entrance.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <AccessLevelBadge level={entrance.access_level ?? "public"} />
                </div>
              </div>
            </div>
            <StatusBadge active={entrance.active} />
          </div>
        </SheetHeader>

        <div className="pt-5 space-y-6">
          {entrance.description && (
            <p className="text-sm text-muted-foreground">{entrance.description}</p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-sky-400">{entrance.camera_count ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t("entrances.cameras")}</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-violet-400">{entrance.intercom_count ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t("entrances.intercoms")}</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-foreground">{events.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Recent</div>
            </div>
          </div>

          {/* Cameras */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4 text-sky-400" />{t("entrances.cameras")}
            </h3>
            {camLoading ? (
              <div className="space-y-2">{[1,2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : cameras.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No cameras assigned to this entrance</p>
            ) : (
              <div className="space-y-2">
                {cameras.map((cam) => (
                  <div key={cam.id} className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <DeviceStatusDot status={cam.status} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{cam.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{cam.ip_address}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="text-xs bg-muted text-muted-foreground border-border hover:bg-muted">{cam.protocol}</Badge>
                      {cam.status === "online" && (
                        <Button
                          variant="outline" size="sm"
                          className="h-7 px-2 text-xs gap-1 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10"
                          onClick={() => testGate(cam.id)}
                          disabled={testingGate === cam.id}
                        >
                          {testingGate === cam.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          Gate
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intercoms */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Phone className="w-4 h-4 text-violet-400" />{t("entrances.intercoms")}
            </h3>
            {intLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 rounded-lg" /></div>
            ) : intercoms.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No controllers assigned to this entrance</p>
            ) : (
              <div className="space-y-2">
                {intercoms.map((ic) => (
                  <div key={ic.id} className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <DeviceStatusDot status={ic.status} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{ic.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{ic.ip_address}</div>
                      </div>
                    </div>
                    <Badge className="text-xs bg-muted text-muted-foreground border-border hover:bg-muted">{ic.protocol}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Events */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />Recent Events
            </h3>
            {evLoading ? (
              <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No events recorded for this entrance</p>
            ) : (
              <div className="space-y-1.5">
                {events.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-medium text-foreground truncate">{ev.license_plate ?? "—"}</span>
                      <span className="text-xs text-muted-foreground capitalize">{ev.event_type.replace("_", " ")}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <EventStatusBadge status={ev.status} />
                      <span className="text-xs text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 border-t border-border flex gap-2">
            <Button variant="outline" className="flex-1 gap-2" onClick={() => onEdit(entrance)}>
              <Pencil className="w-4 h-4" />{t("common.edit")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EntrancesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Entrance | null>(null);
  const [detailEntrance, setDetailEntrance] = useState<Entrance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entrance | null>(null);

  const { data: entrances = [], isLoading } = useQuery<Entrance[]>({
    queryKey: ["entrances"],
    queryFn: () => entrancesApi.list(),
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => entrancesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entrances"] });
      toast({ title: t("entrances.deleted") });
      setDeleteTarget(null);
      if (detailEntrance?.id === deleteTarget?.id) setDetailEntrance(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const active = entrances.filter((e) => e.active).length;
  const inactive = entrances.length - active;
  const totalCameras = entrances.reduce((s, e) => s + (e.camera_count ?? 0), 0);

  function openEdit(e: Entrance) { setEditTarget(e); setDetailEntrance(null); setDialogOpen(true); }
  function openCreate() { setEditTarget(null); setDialogOpen(true); }

  return (
    <AppLayout
      title={t("entrances.title")}
      subtitle={t("entrances.subtitle")}
      actions={
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />{t("entrances.addEntrance")}
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("entrances.totalEntrances"), value: entrances.length, color: "text-foreground" },
            { label: t("entrances.active"),         value: active,            color: "text-emerald-400" },
            { label: t("entrances.inactive"),       value: inactive,          color: "text-zinc-400" },
            { label: t("entrances.camerasDeployed"), value: totalCameras,     color: "text-sky-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        ) : entrances.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <DoorOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="text-lg font-medium text-foreground">{t("entrances.noEntrances")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t("entrances.noEntrancesDesc")}</p>
            <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />{t("entrances.addFirst")}</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {entrances.map((e) => (
              <div
                key={e.id}
                onClick={() => setDetailEntrance(e)}
                className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors cursor-pointer flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <DoorOpen className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-foreground truncate">{e.name}</div>
                    <StatusBadge active={e.active} />
                    <AccessLevelBadge level={e.access_level ?? "public"} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1"><Camera className="w-3 h-3" />{e.camera_count ?? 0}</span>
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{e.intercom_count ?? 0}</span>
                    {e.description && (
                      <span className="truncate max-w-xs">{e.description}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(ev) => ev.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(e)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-400" onClick={() => setDeleteTarget(e)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <EntranceDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditTarget(null); }}
          entrance={editTarget}
        />
      )}

      <EntranceDetailSheet
        entrance={detailEntrance}
        onClose={() => setDetailEntrance(null)}
        onEdit={openEdit}
      />

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
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
