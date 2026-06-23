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
  Camera, CalendarDays, LogIn, LogOut, ShieldX, Upload,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useRef } from "react";
import { CardScanInput } from "@/components/card-scan-input";
import { cn } from "@/lib/utils";
import type { Vehicle } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Department {
  id: string;
  name: string;
  default_shift_id: string | null;
  active: boolean;
}

interface Worker {
  id: string;
  employee_number: string | null;
  badge_no: string | null;
  photo_url: string | null;
  first_name: string;
  last_name: string;
  position: string | null;
  department: string | null;
  department_id: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkerForm {
  employee_number: string;
  badge_no: string;
  photo_url: string;
  first_name: string;
  last_name: string;
  position: string;
  department_id: string;
  phone: string;
  email: string;
  active: boolean;
  notes: string;
}

const defaultForm: WorkerForm = {
  employee_number: "", badge_no: "", photo_url: "",
  first_name: "", last_name: "",
  position: "", department_id: "", phone: "", email: "",
  active: true, notes: "",
};

function fullName(w: Worker) { return `${w.first_name} ${w.last_name}`; }

// ─── Worker Dialog ──────────────────────────────────────────────────────────────

function WorkerDialog({ open, onClose, worker }: { open: boolean; onClose: () => void; worker: Worker | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<WorkerForm>(defaultForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments"),
    enabled: open,
  });

  const activeDepts = departments.filter((d) => d.active);

  useEffect(() => {
    if (!open) return;
    setPhotoFile(null);
    setPhotoPreview(null);
    setForm(worker ? {
      employee_number: worker.employee_number ?? "",
      badge_no: worker.badge_no ?? "",
      photo_url: worker.photo_url ?? "",
      first_name: worker.first_name,
      last_name: worker.last_name,
      position: worker.position ?? "",
      department_id: worker.department_id ?? "",
      phone: worker.phone ?? "",
      email: worker.email ?? "",
      active: worker.active,
      notes: worker.notes ?? "",
    } : defaultForm);
  }, [open, worker]);

  const set = (k: keyof WorkerForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Снимката е твърде голяма", description: "Максимум 5 MB", variant: "destructive" });
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  const mut = useMutation({
    mutationFn: async () => {
      const selectedDept = departments.find((d) => d.id === form.department_id);
      const body = {
        employee_number: form.employee_number || null,
        badge_no: form.badge_no || null,
        photo_url: form.photo_url || null,
        first_name: form.first_name,
        last_name: form.last_name,
        position: form.position || null,
        department: selectedDept?.name ?? null,
        department_id: form.department_id || null,
        phone: form.phone || null,
        email: form.email || null,
        active: form.active,
        notes: form.notes || null,
      };
      const saved: Worker = worker
        ? await api.put(`/workers/${worker.id}`, body)
        : await api.post("/workers", body);

      if (photoFile) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        const token = localStorage.getItem("access_token") ?? "";
        await fetch(`/api/workers/${saved.id}/photo`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: worker ? t("workers.updated") : t("workers.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const isValid = form.first_name.trim().length > 0 && form.last_name.trim().length > 0;
  const initials = `${form.first_name.charAt(0)}${form.last_name.charAt(0)}`.toUpperCase() || "?";
  const currentPhoto = photoPreview ?? (worker?.photo_url || null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{worker ? t("workers.editWorker") : t("workers.addWorker")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
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
              <Label>{t("workers.badgeNo")}</Label>
              <CardScanInput
                value={form.badge_no}
                onChange={(v) => set("badge_no", v)}
                placeholder={t("workers.badgeNoPlaceholder")}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("workers.department")}</Label>
              <Select
                value={form.department_id || "__none__"}
                onValueChange={(v) => set("department_id", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("workers.noDepartment")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("workers.noDepartment")}</SelectItem>
                  {activeDepts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("workers.position")}</Label>
              <Input value={form.position} onChange={(e) => set("position", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("workers.phone")}</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("workers.email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>
          {/* Photo upload */}
          <div className="space-y-1.5">
            <Label>{t("workerCard.photo")}</Label>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="w-16 h-16 rounded-xl overflow-hidden border border-border bg-muted flex items-center justify-center shrink-0">
                {currentPhoto ? (
                  <img src={currentPhoto} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-lg font-bold text-muted-foreground">{initials}</span>
                )}
              </div>
              {/* Buttons */}
              <div className="flex flex-col gap-2 flex-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 w-full justify-start"
                  onClick={() => photoFileRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {photoFile ? photoFile.name : t("workerCard.uploadPhoto")}
                </Button>
                {!photoFile && (
                  <Input
                    value={form.photo_url}
                    placeholder="или URL (https://…)"
                    className="text-xs h-8"
                    onChange={(e) => { set("photo_url", e.target.value); setPhotoPreview(null); }}
                  />
                )}
                {photoFile && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground text-left"
                    onClick={() => { setPhotoFile(null); setPhotoPreview(null); if (photoFileRef.current) photoFileRef.current.value = ""; }}
                  >
                    ✕ премахни избраната снимка
                  </button>
                )}
              </div>
            </div>
            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
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
        <DialogFooter className="shrink-0 pt-2">
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

// ─── Worker Detail Sheet (Profile Card) ────────────────────────────────────────

interface Leave {
  id: string;
  type: "vacation" | "sick" | "business_trip" | "other";
  start_date: string;
  end_date: string;
  note: string | null;
}

interface AccessEvent {
  id: string;
  timestamp: string;
  event_type: "entry" | "exit" | "denied" | "manual_open" | "override";
  status: "allowed" | "denied" | "manual" | "pending";
  license_plate: string | null;
  entrance_id: string | null;
}

const LEAVE_LABELS = {
  vacation: "Платен отпуск",
  sick: "Болничен",
  business_trip: "Командировка",
  other: "Друго",
} as const;

function WorkerAvatar({
  worker,
  size = "lg",
  onUpload,
}: {
  worker: Worker;
  size?: "sm" | "lg";
  onUpload?: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dim = size === "lg" ? "w-24 h-24" : "w-10 h-10";
  const text = size === "lg" ? "text-3xl" : "text-sm";
  const initials = `${worker.first_name[0] ?? ""}${worker.last_name[0] ?? ""}`.toUpperCase();

  return (
    <div className={cn("relative shrink-0 group", dim)}>
      {worker.photo_url ? (
        <img
          src={worker.photo_url}
          alt={fullName(worker)}
          className={cn("rounded-full object-cover border-2 border-border", dim)}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className={cn(
          "rounded-full flex items-center justify-center font-bold bg-primary/20 text-primary border-2 border-border",
          dim, text
        )}>
          {initials}
        </div>
      )}
      {onUpload && (
        <>
          <button
            className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="w-5 h-5 text-white" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { onUpload(f); e.target.value = ""; }
            }}
          />
        </>
      )}
    </div>
  );
}

function WorkerDetailSheet({
  worker,
  onClose,
  onEdit,
  onDeactivate,
}: {
  worker: Worker | null;
  onClose: () => void;
  onEdit: (w: Worker) => void;
  onDeactivate: (w: Worker) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: leaves = [] } = useQuery<Leave[]>({
    queryKey: ["worker-leaves", worker?.id],
    queryFn: () => api.get(`/workers/${worker!.id}/leaves`),
    enabled: !!worker,
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery<AccessEvent[]>({
    queryKey: ["worker-events", worker?.id],
    queryFn: () => api.get(`/workers/${worker!.id}/events`),
    enabled: !!worker,
  });

  const photoMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(`/api/workers/${worker!.id}/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json() as Promise<{ photo_url: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: t("workerCard.changePhoto") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const activeLeave = leaves.find(l => l.start_date <= today && l.end_date >= today);

  if (!worker) return null;

  return (
    <Sheet open={!!worker} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        {/* Hero header */}
        <div className="p-6 pb-4 border-b border-border bg-muted/20">
          <div className="flex items-start gap-4">
            <WorkerAvatar
              worker={worker}
              size="lg"
              onUpload={(f) => photoMut.mutate(f)}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-xl font-bold leading-tight">{fullName(worker)}</h2>
                  {worker.position && (
                    <p className="text-sm text-muted-foreground mt-0.5">{worker.position}</p>
                  )}
                  {worker.department && (
                    <p className="text-xs text-muted-foreground">{worker.department}</p>
                  )}
                </div>
                <div>
                  {worker.active
                    ? <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-xs shrink-0"><UserCheck className="w-3 h-3 mr-1" />{t("workers.active")}</Badge>
                    : <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-xs shrink-0"><UserX className="w-3 h-3 mr-1" />{t("workers.inactive")}</Badge>
                  }
                </div>
              </div>

              {/* Active leave banner */}
              {activeLeave && (
                <div className="mt-2 flex items-center gap-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-2.5 py-1.5 text-xs text-yellow-400">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {LEAVE_LABELS[activeLeave.type]} — {t("workerCard.onLeaveUntil")}{" "}
                    {new Date(activeLeave.end_date + "T00:00:00").toLocaleDateString("bg-BG", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => { onEdit(worker); onClose(); }}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />{t("common.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    worker.active
                      ? "text-amber-500 border-amber-300/50 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      : "text-green-500 border-green-300/50 hover:bg-green-50 dark:hover:bg-green-950/30"
                  )}
                  onClick={() => { onDeactivate(worker); onClose(); }}
                >
                  {worker.active ? <UserX className="w-3.5 h-3.5 mr-1.5" /> : <UserCheck className="w-3.5 h-3.5 mr-1.5" />}
                  {worker.active ? t("workers.deactivate") : t("workers.reactivate")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-6">
          <Tabs defaultValue="info">
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="info" className="flex-1">{t("workers.info")}</TabsTrigger>
              <TabsTrigger value="vehicles" className="flex-1">{t("nav.vehicles")}</TabsTrigger>
              <TabsTrigger value="events" className="flex-1">{t("workerCard.eventsTab")}</TabsTrigger>
            </TabsList>

            {/* Info tab */}
            <TabsContent value="info">
              <dl className="space-y-3 text-sm">
                {([
                  [t("workers.employeeNumber"), worker.employee_number],
                  [t("workers.badgeNo"), worker.badge_no],
                  [t("workers.phone"), worker.phone],
                  [t("workers.email"), worker.email],
                ] as [string, string | null][]).filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex justify-between border-b border-border/40 pb-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium font-mono text-xs">{value}</dd>
                  </div>
                ))}
                {worker.notes && (
                  <div>
                    <dt className="text-xs text-muted-foreground mb-1">{t("common.notes")}</dt>
                    <dd className="text-sm bg-muted/30 rounded-lg px-3 py-2">{worker.notes}</dd>
                  </div>
                )}

                {/* Recent leaves */}
                {leaves.length > 0 && (
                  <div className="pt-2">
                    <dt className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />{t("nav.leaves")}
                    </dt>
                    <div className="space-y-1.5">
                      {leaves.slice(0, 3).map((l) => (
                        <div key={l.id} className={cn(
                          "flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 border",
                          l.start_date <= today && l.end_date >= today
                            ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                            : "bg-muted/20 border-border/40 text-muted-foreground"
                        )}>
                          <span>{LEAVE_LABELS[l.type]}</span>
                          <span>{l.start_date} → {l.end_date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </dl>
            </TabsContent>

            {/* Vehicles tab */}
            <TabsContent value="vehicles">
              <VehiclesTab worker={worker} />
            </TabsContent>

            {/* Events tab */}
            <TabsContent value="events">
              {eventsLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />{t("common.loading")}
                </div>
              ) : events.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <LogIn className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  {t("workerCard.noEvents")}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {events.map((ev) => {
                    const allowed = ev.status === "allowed" || ev.status === "manual";
                    const isEntry = ev.event_type === "entry" || ev.event_type === "manual_open";
                    return (
                      <div key={ev.id} className="flex items-center gap-3 text-sm border border-border/40 rounded-lg px-3 py-2">
                        <div className={cn(
                          "shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
                          allowed ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                        )}>
                          {allowed
                            ? (isEntry ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />)
                            : <ShieldX className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs font-medium">{ev.license_plate ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(ev.timestamp).toLocaleString("bg-BG", {
                              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                            })}
                          </div>
                        </div>
                        <span className={cn(
                          "text-[10px] font-medium",
                          allowed ? "text-green-400" : "text-red-400"
                        )}>
                          {allowed ? t("workerCard.allowed") : t("workerCard.denied")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
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

  const toggleActiveMut = useMutation({
    mutationFn: (w: Worker) => api.put(`/workers/${w.id}`, { active: !w.active }),
    onSuccess: (_data, w) => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: w.active ? t("workers.deactivated") : t("workers.reactivated") });
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
                          className="gap-1"
                          onClick={() => { setEditTarget(w); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span className="hidden md:inline text-xs">{t("common.edit")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn("gap-1", w.active ? "text-amber-500 hover:text-amber-600" : "text-green-500 hover:text-green-600")}
                          onClick={() => toggleActiveMut.mutate(w)}
                          disabled={toggleActiveMut.isPending}
                          title={w.active ? t("workers.deactivate") : t("workers.reactivate")}
                        >
                          {w.active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          <span className="hidden md:inline text-xs">{w.active ? t("workers.deactivate") : t("workers.reactivate")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive gap-1"
                          onClick={() => setDeleteTarget(w)}
                          title={t("workers.hardDelete")}
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

      <WorkerDetailSheet
        worker={detailTarget}
        onClose={() => setDetailTarget(null)}
        onEdit={(w) => { setEditTarget(w); setDialogOpen(true); }}
        onDeactivate={(w) => toggleActiveMut.mutate(w)}
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
