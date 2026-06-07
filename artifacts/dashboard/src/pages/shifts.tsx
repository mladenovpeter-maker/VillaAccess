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
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Clock, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ShiftForm {
  name: string;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  active: boolean;
  notes: string;
}

const defaultForm: ShiftForm = {
  name: "", start_time: "08:00", end_time: "17:00",
  days_of_week: [1, 2, 3, 4, 5], active: true, notes: "",
};

const DAY_LABELS = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_LABELS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function formatDays(days: number[], lang = "bg"): string {
  const labels = lang === "bg" ? DAY_LABELS : DAY_LABELS_EN;
  if (days.length === 7) return lang === "bg" ? "Всеки ден" : "Every day";
  return days.map((d) => labels[d]).join(", ");
}

// ─── Shift Dialog ──────────────────────────────────────────────────────────────

function ShiftDialog({ open, onClose, shift }: { open: boolean; onClose: () => void; shift: Shift | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<ShiftForm>(defaultForm);

  useEffect(() => {
    if (!open) return;
    setForm(shift ? {
      name: shift.name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      days_of_week: shift.days_of_week,
      active: shift.active,
      notes: shift.notes ?? "",
    } : defaultForm);
  }, [open, shift]);

  const set = (k: keyof ShiftForm, v: string | boolean | number[]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleDay = (d: number) =>
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter((x) => x !== d)
        : [...f.days_of_week, d].sort(),
    }));

  const mut = useMutation({
    mutationFn: async () => {
      const body = { ...form, notes: form.notes || null };
      if (shift) return api.put(`/shifts/${shift.id}`, body);
      return api.post("/shifts", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: shift ? t("shifts.updated") : t("shifts.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const isValid = form.name.trim().length > 0 && form.days_of_week.length > 0;
  const lang = i18n.language;
  const dayLabels = lang === "bg" ? DAY_LABELS : DAY_LABELS_EN;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{shift ? t("shifts.editShift") : t("shifts.addShift")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("shifts.shiftName")} *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("shifts.namePlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("shifts.startTime")}</Label>
              <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("shifts.endTime")}</Label>
              <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("shifts.daysOfWeek")}</Label>
            <div className="flex gap-1 flex-wrap">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "w-9 h-9 rounded-lg text-xs font-medium border transition-colors",
                    form.days_of_week.includes(d)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60"
                  )}
                >
                  {dayLabels[d]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("common.notes")}</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="shift-active"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="shift-active">{t("shifts.active")}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!isValid || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {shift ? t("common.saveChanges") : t("shifts.addShift")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function ShiftsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Shift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);

  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ["shifts"],
    queryFn: () => api.get("/shifts"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/shifts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: t("shifts.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const lang = i18n.language;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="w-6 h-6" />
              {t("shifts.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("shifts.subtitle")}</p>
          </div>
          <Button onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            {t("shifts.addShift")}
          </Button>
        </div>

        {/* Cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />{t("common.loading")}
          </div>
        ) : shifts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">{t("shifts.noShifts")}</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shifts.map((s) => (
              <div key={s.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatDays(s.days_of_week, lang)}</div>
                  </div>
                  {s.active
                    ? <Badge className="bg-green-500/15 text-green-400 border-green-500/20 hover:bg-green-500/15">{t("shifts.active")}</Badge>
                    : <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15">{t("shifts.inactive")}</Badge>
                  }
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono font-medium">{s.start_time} – {s.end_time}</span>
                </div>
                {s.notes && (
                  <p className="text-xs text-muted-foreground">{s.notes}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => { setEditTarget(s); setDialogOpen(true); }}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(s)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ShiftDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        shift={editTarget}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("shifts.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("shifts.deleteDesc")} <strong>{deleteTarget?.name}</strong>?
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
