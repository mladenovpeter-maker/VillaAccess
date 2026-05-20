import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, villasApi, type Villa } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import {
  Building2, Plus, Pencil, Trash2, MapPin, CalendarDays, Car,
  Loader2, Search, CheckCircle2, XCircle, AlertTriangle, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VillaDetail extends Villa {
  description: string | null;
  location: string | null;
  vehicle_count: number;
  created_at: string;
  updated_at: string;
}

interface VillaReservation {
  id: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  status: string;
  pin_code: string | null;
}

interface VillaForm {
  name: string;
  description: string;
  location: string;
  status: "active" | "inactive" | "maintenance";
}

const defaultForm: VillaForm = { name: "", description: "", location: "", status: "active" };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
  if (status === "maintenance")
    return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15"><AlertTriangle className="w-3 h-3 mr-1" />Maintenance</Badge>;
  return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15"><XCircle className="w-3 h-3 mr-1" />Inactive</Badge>;
}

const reservationStatusColors: Record<string, string> = {
  upcoming: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  completed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/20",
};

// ─── Villa Form Dialog ──────────────────────────────────────────────────────────

function VillaDialog({ open, onClose, villa }: { open: boolean; onClose: () => void; villa: VillaDetail | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<VillaForm>(
    villa ? { name: villa.name, description: villa.description ?? "", location: villa.location ?? "", status: villa.status as VillaForm["status"] } : defaultForm
  );

  const set = (k: keyof VillaForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const body = { name: form.name, description: form.description || null, location: form.location || null, status: form.status };
      if (villa) return api.put(`/villas/${villa.id}`, body);
      return api.post("/villas", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["villas"] });
      toast({ title: villa ? t("villas.updated") : t("villas.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{villa ? t("villas.editVilla") : t("villas.addVilla")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("villas.villaName")} *</Label>
            <Input placeholder="e.g. Villa Serenity" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("villas.description")}</Label>
            <Input placeholder="Short description" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("villas.location")}</Label>
            <Input placeholder="e.g. North wing, Jl. Pantai Indah" value={form.location} onChange={(e) => set("location", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("common.status")}</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("villas.status.active")}</SelectItem>
                <SelectItem value="inactive">{t("villas.status.inactive")}</SelectItem>
                <SelectItem value="maintenance">{t("villas.status.maintenance")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!form.name || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {villa ? t("common.saveChanges") : t("villas.createVilla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Villa Detail Sheet ─────────────────────────────────────────────────────────

function VillaDetailSheet({ villa, onClose, onEdit, readOnly }: { villa: VillaDetail | null; onClose: () => void; onEdit: (v: VillaDetail) => void; readOnly?: boolean }) {
  const { t } = useTranslation();

  const { data: reservations = [], isLoading: resLoading } = useQuery<VillaReservation[]>({
    queryKey: ["villa-reservations", villa?.id],
    queryFn: () => api.get(`/villas/${villa!.id}/reservations`),
    enabled: !!villa,
  });

  if (!villa) return null;

  return (
    <Sheet open={!!villa} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-base">{villa.name}</SheetTitle>
                {villa.location && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="w-3 h-3" />{villa.location}
                  </div>
                )}
              </div>
            </div>
            <StatusBadge status={villa.status} />
          </div>
        </SheetHeader>

        <div className="pt-5 space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{t("villas.activeReservations")}</div>
              <div className="text-2xl font-bold text-foreground">{villa.active_reservations}</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Car className="w-3.5 h-3.5" />{t("villas.linkedVehicles")}</div>
              <div className="text-2xl font-bold text-foreground">{villa.vehicle_count}</div>
            </div>
          </div>

          {villa.description && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("villas.description")}</p>
              <p className="text-sm text-foreground">{villa.description}</p>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("villas.created")}: {formatDate(villa.created_at)}</span>
            <span>·</span>
            <span>{t("villas.updated")}: {formatDate(villa.updated_at)}</span>
          </div>

          {/* Reservations */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{t("villas.reservationHistory")}</h3>
              <span className="text-xs text-muted-foreground">{reservations.length} {t("common.total").toLowerCase()}</span>
            </div>

            {resLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : reservations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t("villas.noReservations")}</div>
            ) : (
              <div className="space-y-2">
                {reservations.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{r.guest_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(r.check_in)} → {formatDate(r.check_out)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.pin_code && (
                        <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{r.pin_code}</span>
                      )}
                      <Badge className={cn("text-xs border", reservationStatusColors[r.status] ?? "bg-zinc-500/15 text-zinc-400")}>
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {!readOnly && (
            <div className="pt-2 border-t border-border flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => onEdit(villa)}>
                <Pencil className="w-4 h-4" />{t("common.edit")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function VillasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VillaDetail | null>(null);
  const [detailVilla, setDetailVilla] = useState<VillaDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VillaDetail | null>(null);

  const { data: villas = [], isLoading } = useQuery<VillaDetail[]>({
    queryKey: ["villas"],
    queryFn: () => api.get("/villas"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/villas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["villas"] });
      toast({ title: t("villas.deleted") });
      setDeleteTarget(null);
      if (detailVilla?.id === deleteTarget?.id) setDetailVilla(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const filtered = villas.filter((v) => {
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const total = villas.length;
  const active = villas.filter((v) => v.status === "active").length;
  const inactive = villas.filter((v) => v.status === "inactive").length;
  const maintenance = villas.filter((v) => v.status === "maintenance").length;

  const { user } = useAuth();
  const isViewer = user?.role === "viewer";

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(v: VillaDetail) { setEditTarget(v); setDetailVilla(null); setDialogOpen(true); }

  return (
    <AppLayout
      title={t("villas.title")}
      subtitle={t("villas.subtitle")}
      actions={!isViewer ? (
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />{t("villas.addVilla")}
        </Button>
      ) : undefined}
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("villas.total"), value: total, color: "text-foreground" },
            { label: t("villas.status.active"), value: active, color: "text-emerald-400" },
            { label: t("villas.status.maintenance"), value: maintenance, color: "text-amber-400" },
            { label: t("villas.status.inactive"), value: inactive, color: "text-zinc-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("villas.searchVillas")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="active">{t("villas.status.active")}</SelectItem>
              <SelectItem value="inactive">{t("villas.status.inactive")}</SelectItem>
              <SelectItem value="maintenance">{t("villas.status.maintenance")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[1,2,3,4].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-7 h-7 text-primary/60" />
            </div>
            <div>
              <p className="font-medium text-foreground">{search || statusFilter !== "all" ? t("villas.noResults") : t("villas.noVillas")}</p>
              <p className="text-sm text-muted-foreground">{t("villas.noVillasDesc")}</p>
            </div>
            {!search && statusFilter === "all" && !isViewer && (
              <Button onClick={openCreate} variant="outline" size="sm" className="gap-2">
                <Plus className="w-4 h-4" />{t("villas.addFirst")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((villa) => (
              <div
                key={villa.id}
                className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => setDetailVilla(villa)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{villa.name}</div>
                      {villa.location && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground truncate mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />{villa.location}
                        </div>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={villa.status} />
                </div>

                {villa.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{villa.description}</p>
                )}

                <div className="flex items-center gap-4 pt-1 border-t border-border">
                  <div className="flex items-center gap-1.5 text-sm">
                    <CalendarDays className="w-4 h-4 text-blue-400" />
                    <span className="font-medium text-foreground">{villa.active_reservations}</span>
                    <span className="text-xs text-muted-foreground">{t("villas.activeLabel")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Car className="w-4 h-4 text-emerald-400" />
                    <span className="font-medium text-foreground">{villa.vehicle_count}</span>
                    <span className="text-xs text-muted-foreground">{t("villas.vehiclesLabel")}</span>
                  </div>
                  <div className="ml-auto text-xs text-muted-foreground">{formatDate(villa.updated_at)}</div>
                </div>

                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => setDetailVilla(villa)}>
                    <ExternalLink className="w-3.5 h-3.5" />{t("villas.viewDetails")}
                  </Button>
                  {!isViewer && (
                    <>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(villa)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                        onClick={() => setDeleteTarget(villa)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <VillaDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditTarget(null); }} villa={editTarget} />

      <VillaDetailSheet
        villa={detailVilla}
        onClose={() => setDetailVilla(null)}
        onEdit={(v) => { openEdit(v); }}
        readOnly={isViewer}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("villas.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> {t("villas.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
