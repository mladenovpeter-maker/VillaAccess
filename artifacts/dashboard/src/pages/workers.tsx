import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  HardHat, Plus, Pencil, Trash2, Loader2, Search,
  Car, UserCheck, UserX, Link2, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Vehicle } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  position: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkerForm {
  employee_number: string;
  first_name: string;
  last_name: string;
  position: string;
  department: string;
  phone: string;
  email: string;
  active: boolean;
  notes: string;
}

const defaultForm: WorkerForm = {
  employee_number: "", first_name: "", last_name: "",
  position: "", department: "", phone: "", email: "",
  active: true, notes: "",
};

function fullName(w: Worker) { return `${w.first_name} ${w.last_name}`; }

// ─── Worker Dialog ──────────────────────────────────────────────────────────────

function WorkerDialog({ open, onClose, worker }: { open: boolean; onClose: () => void; worker: Worker | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<WorkerForm>(defaultForm);

  useEffect(() => {
    if (!open) return;
    setForm(worker ? {
      employee_number: worker.employee_number ?? "",
      first_name: worker.first_name,
      last_name: worker.last_name,
      position: worker.position ?? "",
      department: worker.department ?? "",
      phone: worker.phone ?? "",
      email: worker.email ?? "",
      active: worker.active,
      notes: worker.notes ?? "",
    } : defaultForm);
  }, [open, worker]);

  const set = (k: keyof WorkerForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        employee_number: form.employee_number || null,
        first_name: form.first_name,
        last_name: form.last_name,
        position: form.position || null,
        department: form.department || null,
        phone: form.phone || null,
        email: form.email || null,
        active: form.active,
        notes: form.notes || null,
      };
      if (worker) return api.put(`/workers/${worker.id}`, body);
      return api.post("/workers", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: worker ? t("workers.updated") : t("workers.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const isValid = form.first_name.trim().length > 0 && form.last_name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{worker ? t("workers.editWorker") : t("workers.addWorker")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("workers.firstName")} *</Label>
              <Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("workers.lastName")} *</Label>
              <Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("workers.employeeNumber")}</Label>
              <Input value={form.employee_number} onChange={(e) => set("employee_number", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("workers.department")}</Label>
              <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("workers.position")}</Label>
              <Input value={form.position} onChange={(e) => set("position", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("workers.phone")}</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("workers.email")}</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("common.notes")}</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="worker-active"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="worker-active">{t("workers.active")}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!isValid || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {worker ? t("common.saveChanges") : t("workers.addWorker")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Vehicle Link Dialog ────────────────────────────────────────────────────────

function VehiclesTab({ worker }: { worker: Worker }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [linkVehicleId, setLinkVehicleId] = useState("");

  const { data: workerVehicles = [], isLoading: loadingWV } = useQuery<Vehicle[]>({
    queryKey: ["worker-vehicles", worker.id],
    queryFn: () => api.get(`/workers/${worker.id}/vehicles`),
  });

  const { data: allVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: () => api.get("/vehicles"),
  });

  const linked = new Set(workerVehicles.map((v) => v.id));
  const available = allVehicles.filter((v) => !linked.has(v.id));

  const linkMut = useMutation({
    mutationFn: (vehicle_id: string) => api.post(`/workers/${worker.id}/vehicles`, { vehicle_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-vehicles", worker.id] });
      toast({ title: t("workers.vehicleLinked") });
      setLinkVehicleId("");
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const unlinkMut = useMutation({
    mutationFn: (vehicleId: string) => api.delete(`/workers/${worker.id}/vehicles/${vehicleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-vehicles", worker.id] });
      toast({ title: t("workers.vehicleUnlinked") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Link new vehicle */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={linkVehicleId} onValueChange={setLinkVehicleId}>
            <SelectTrigger>
              <SelectValue placeholder={t("workers.selectVehicle")} />
            </SelectTrigger>
            <SelectContent>
              {available.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.license_plate}{v.make ? ` — ${v.make} ${v.model ?? ""}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => linkMut.mutate(linkVehicleId)}
          disabled={!linkVehicleId || linkMut.isPending}
        >
          {linkMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          <span className="ml-2">{t("workers.linkVehicle")}</span>
        </Button>
      </div>

      {/* List */}
      {loadingWV ? (
        <div className="text-center py-6 text-muted-foreground text-sm">{t("common.loading")}</div>
      ) : workerVehicles.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">{t("workers.noVehicles")}</div>
      ) : (
        <div className="space-y-2">
          {workerVehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-muted-foreground" />
                <span className="font-mono text-sm font-medium">{v.license_plate}</span>
                {v.make && <span className="text-xs text-muted-foreground">{v.make} {v.model}</span>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => unlinkMut.mutate(v.id)}
                disabled={unlinkMut.isPending}
              >
                <Unlink className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Worker Detail Dialog ───────────────────────────────────────────────────────

function WorkerDetailDialog({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!worker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="w-4 h-4" />
            {worker ? fullName(worker) : ""}
          </DialogTitle>
        </DialogHeader>
        {worker && (
          <Tabs defaultValue="info">
            <TabsList className="mb-4">
              <TabsTrigger value="info">{t("workers.info")}</TabsTrigger>
              <TabsTrigger value="vehicles">{t("nav.vehicles")}</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  [t("workers.employeeNumber"), worker.employee_number],
                  [t("workers.department"), worker.department],
                  [t("workers.position"), worker.position],
                  [t("workers.phone"), worker.phone],
                  [t("workers.email"), worker.email],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label as string}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ) : null
                )}
                {worker.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">{t("common.notes")}</dt>
                    <dd className="font-medium">{worker.notes}</dd>
                  </div>
                )}
              </dl>
            </TabsContent>
            <TabsContent value="vehicles">
              <VehiclesTab worker={worker} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Worker | null>(null);
  const [detailTarget, setDetailTarget] = useState<Worker | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);

  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: () => api.get("/workers"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/workers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: t("workers.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const filtered = workers.filter((w) => {
    const matchActive =
      activeFilter === "all" ||
      (activeFilter === "active" ? w.active : !w.active);
    const matchSearch =
      !search ||
      fullName(w).toLowerCase().includes(search.toLowerCase()) ||
      (w.employee_number ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (w.department ?? "").toLowerCase().includes(search.toLowerCase());
    return matchActive && matchSearch;
  });

  const active = workers.filter((w) => w.active).length;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HardHat className="w-6 h-6" />
              {t("workers.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("workers.subtitle")}</p>
          </div>
          <Button onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            {t("workers.addWorker")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t("workers.total"), value: workers.length },
            { label: t("workers.activeWorkers"), value: active },
            { label: t("workers.inactiveWorkers"), value: workers.length - active },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("workers.searchWorkers")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="active">{t("workers.active")}</SelectItem>
              <SelectItem value="inactive">{t("workers.inactive")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />{t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">{t("workers.noWorkers")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("workers.name")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("workers.employeeNumber")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("workers.department")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("workers.position")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("common.status")}</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr
                    key={w.id}
                    className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                    onClick={() => setDetailTarget(w)}
                  >
                    <td className="px-4 py-3 font-medium">{fullName(w)}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{w.employee_number ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{w.department ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{w.position ?? "—"}</td>
                    <td className="px-4 py-3">
                      {w.active
                        ? <Badge className="bg-green-500/15 text-green-400 border-green-500/20 hover:bg-green-500/15"><UserCheck className="w-3 h-3 mr-1" />{t("workers.active")}</Badge>
                        : <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15"><UserX className="w-3 h-3 mr-1" />{t("workers.inactive")}</Badge>
                      }
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditTarget(w); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(w)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <WorkerDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        worker={editTarget}
      />

      <WorkerDetailDialog
        worker={detailTarget}
        onClose={() => setDetailTarget(null)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workers.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workers.deleteDesc")} <strong>{deleteTarget ? fullName(deleteTarget) : ""}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
