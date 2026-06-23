import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  CalendarDays, Plus, Pencil, Trash2, Loader2, Search, Check, ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = "vacation" | "sick" | "business_trip" | "other";

interface Worker {
  id: string;
  first_name: string;
  last_name: string;
  department: string | null;
  employee_number: string | null;
  photo_url: string | null;
  active: boolean;
}

interface Leave {
  id: string;
  worker_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
  worker: Worker | null;
}

interface LeaveForm {
  worker_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  note: string;
}

const today = new Date().toISOString().slice(0, 10);

function defaultForm(): LeaveForm {
  return { worker_id: "", type: "vacation", start_date: today, end_date: today, note: "" };
}

// ─── Type badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type, t }: { type: LeaveType; t: (k: string) => string }) {
  const map: Record<LeaveType, string> = {
    vacation:      "bg-blue-500/15 text-blue-400 border-blue-500/20",
    sick:          "bg-red-500/15 text-red-400 border-red-500/20",
    business_trip: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    other:         "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  };
  const labels: Record<LeaveType, string> = {
    vacation:      t("leaves.typeVacation"),
    sick:          t("leaves.typeSick"),
    business_trip: t("leaves.typeBusinessTrip"),
    other:         t("leaves.typeOther"),
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium", map[type])}>
      {labels[type]}
    </span>
  );
}

function dateDiff(start: string, end: string) {
  const s = new Date(start), e = new Date(end);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function isActiveNow(leave: Leave) {
  return leave.start_date <= today && leave.end_date >= today;
}

function workerFullName(w: Worker | null) {
  if (!w) return "—";
  return `${w.last_name} ${w.first_name}`;
}

// ─── Searchable Worker Combobox ────────────────────────────────────────────────

function WorkerCombobox({
  workers,
  value,
  onChange,
  placeholder = "— изберете работник —",
  className,
}: {
  workers: Worker[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = workers.find(w => w.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">
            {selected ? (
              <span>
                {workerFullName(selected)}
                {selected.department && (
                  <span className="text-muted-foreground ml-1.5 text-xs">({selected.department})</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Търси по име или отдел…" />
          <CommandList className="max-h-60">
            <CommandEmpty>Няма намерени работници</CommandEmpty>
            <CommandGroup>
              {workers
                .sort((a, b) => workerFullName(a).localeCompare(workerFullName(b)))
                .map((w) => (
                  <CommandItem
                    key={w.id}
                    value={`${workerFullName(w)} ${w.department ?? ""} ${w.employee_number ?? ""}`}
                    onSelect={() => { onChange(w.id); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 w-4 h-4 shrink-0", value === w.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{workerFullName(w)}</div>
                      {w.department && (
                        <div className="text-xs text-muted-foreground">{w.department}</div>
                      )}
                    </div>
                    {w.employee_number && (
                      <span className="text-xs text-muted-foreground font-mono ml-2">{w.employee_number}</span>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Leave Dialog ─────────────────────────────────────────────────────────────

function LeaveDialog({ open, onClose, leave, workers }: {
  open: boolean; onClose: () => void;
  leave: Leave | null; workers: Worker[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<LeaveForm>(defaultForm());

  const set = <K extends keyof LeaveForm>(k: K, v: LeaveForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const resetForm = () => {
    setForm(leave ? {
      worker_id: leave.worker_id,
      type:      leave.type,
      start_date: leave.start_date,
      end_date:   leave.end_date,
      note:       leave.note ?? "",
    } : defaultForm());
  };

  useEffect(() => { if (open) resetForm(); }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        worker_id:  form.worker_id,
        type:       form.type,
        start_date: form.start_date,
        end_date:   form.end_date,
        note:       form.note || null,
      };
      return leave
        ? api.put(`/leaves/${leave.id}`, body)
        : api.post("/leaves", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toast({ title: leave ? t("leaves.updated") : t("leaves.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const valid = form.worker_id && form.start_date && form.end_date && form.end_date >= form.start_date;
  const activeWorkers = workers.filter(w => w.active);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); else resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            {leave ? t("leaves.editLeave") : t("leaves.addLeave")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Worker — searchable combobox */}
          <div className="space-y-1.5">
            <Label>{t("leaves.worker")}</Label>
            <WorkerCombobox
              workers={activeWorkers}
              value={form.worker_id}
              onChange={(id) => set("worker_id", id)}
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>{t("leaves.type")}</Label>
            <Select value={form.type} onValueChange={(v) => set("type", v as LeaveType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["vacation", "sick", "business_trip", "other"] as LeaveType[]).map((lt) => (
                  <SelectItem key={lt} value={lt}>
                    <TypeBadge type={lt} t={t} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("leaves.startDate")}</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("leaves.endDate")}</Label>
              <Input
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={(e) => set("end_date", e.target.value)}
              />
            </div>
          </div>
          {form.start_date && form.end_date && form.end_date >= form.start_date && (
            <p className="text-xs text-muted-foreground -mt-2">
              {dateDiff(form.start_date, form.end_date)} {t("leaves.days")}
            </p>
          )}
          {form.end_date && form.end_date < form.start_date && (
            <p className="text-xs text-red-400 -mt-2">Крайната дата е преди началната</p>
          )}

          {/* Note */}
          <div className="space-y-1.5">
            <Label>{t("leaves.note")}</Label>
            <Input placeholder={t("leaves.notePlaceholder")} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {leave ? t("common.save") : t("leaves.addLeave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeavesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<LeaveType | "all">("all");
  const [filterWorker, setFilterWorker] = useState("all");
  const [showActive, setShowActive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Leave | null>(null);
  const [deleting, setDeleting] = useState<Leave | null>(null);

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: () => api.get("/workers"),
  });

  const { data: leaves = [], isLoading } = useQuery<Leave[]>({
    queryKey: ["leaves"],
    queryFn: () => api.get("/leaves"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leaves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toast({ title: t("leaves.deleted") });
      setDeleting(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const leaveTypes: LeaveType[] = ["vacation", "sick", "business_trip", "other"];

  const filtered = leaves.filter((l) => {
    if (filterType !== "all" && l.type !== filterType) return false;
    if (filterWorker !== "all" && l.worker_id !== filterWorker) return false;
    if (showActive && !isActiveNow(l)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const name = workerFullName(l.worker).toLowerCase();
      if (!name.includes(q) && !(l.note ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const onLeaveToday = leaves.filter(isActiveNow);

  function openAdd() { setEditing(null); setDialogOpen(true); }
  function openEdit(l: Leave) { setEditing(l); setDialogOpen(true); }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays className="w-6 h-6" />
              {t("leaves.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("leaves.subtitle")}</p>
          </div>
          <Button onClick={openAdd} className="flex items-center gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            {t("leaves.addLeave")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {leaveTypes.map((lt) => {
            const count = leaves.filter(l => l.type === lt).length;
            const activeCount = onLeaveToday.filter(l => l.type === lt).length;
            return (
              <div key={lt} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="text-2xl font-bold">{count}</div>
                <TypeBadge type={lt} t={t} />
                {activeCount > 0 && (
                  <div className="text-[10px] text-yellow-400 mt-1">{activeCount} {t("leaves.onLeaveNow").toLowerCase()}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Active today banner */}
        {onLeaveToday.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
            <div className="text-sm font-medium text-yellow-400 mb-2">
              📅 {t("leaves.today")} ({onLeaveToday.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {onLeaveToday.map((l) => (
                <div key={l.id} className="flex items-center gap-1.5 bg-card rounded-lg px-2.5 py-1 border border-border">
                  <span className="text-sm font-medium">{workerFullName(l.worker)}</span>
                  <TypeBadge type={l.type} t={t} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Free-text search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 w-48 text-sm"
              placeholder={t("common.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Worker filter — searchable combobox */}
          <WorkerCombobox
            workers={workers.filter(w => w.active)}
            value={filterWorker === "all" ? "" : filterWorker}
            onChange={(id) => setFilterWorker(id || "all")}
            placeholder={t("leaves.filterWorker")}
            className="h-8 w-52 text-sm"
          />
          {filterWorker !== "all" && (
            <button
              onClick={() => setFilterWorker("all")}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              ✕ изчисти
            </button>
          )}

          {/* Type filter */}
          <Select value={filterType} onValueChange={(v) => setFilterType(v as LeaveType | "all")}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue placeholder={t("leaves.filterType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("leaves.filterType")}</SelectItem>
              {leaveTypes.map((lt) => (
                <SelectItem key={lt} value={lt}>
                  <TypeBadge type={lt} t={t} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Active now toggle */}
          <button
            onClick={() => setShowActive((v) => !v)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              showActive
                ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400"
                : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
            )}
          >
            {t("leaves.onLeaveNow")}
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />{t("common.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-20" />
            {t("leaves.noLeaves")}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("leaves.worker")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("leaves.type")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("leaves.startDate")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("leaves.endDate")}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{t("leaves.note")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered
                  .sort((a, b) => b.start_date.localeCompare(a.start_date))
                  .map((l) => {
                    const active = isActiveNow(l);
                    const days = dateDiff(l.start_date, l.end_date);
                    return (
                      <tr key={l.id} className={cn("border-b border-border/50 hover:bg-muted/10", active && "bg-yellow-500/5")}>
                        <td className="px-4 py-3">
                          <div className="font-medium leading-tight">{workerFullName(l.worker)}</div>
                          {l.worker?.department && (
                            <div className="text-[10px] text-muted-foreground">{l.worker.department}</div>
                          )}
                          {active && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                              {t("leaves.onLeaveNow")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3"><TypeBadge type={l.type} t={t} /></td>
                        <td className="px-4 py-3 text-sm">
                          {new Date(l.start_date + "T00:00:00").toLocaleDateString("bg-BG", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div>{new Date(l.end_date + "T00:00:00").toLocaleDateString("bg-BG", { day: "2-digit", month: "short", year: "numeric" })}</div>
                          <div className="text-[10px] text-muted-foreground">{days} {t("leaves.days")}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs max-w-xs truncate">
                          {l.note || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEdit(l)}
                              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleting(l)}
                              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeaveDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        leave={editing}
        workers={workers}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leaves.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {workerFullName(deleting?.worker ?? null)} — {deleting && <TypeBadge type={deleting.type} t={t} />}
              {" "}{deleting?.start_date} → {deleting?.end_date}
              <br />{t("leaves.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
