import { useState } from "react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Building2, Plus, Pencil, Trash2, Loader2, HardHat } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  active: boolean;
}

interface Department {
  id: string;
  name: string;
  default_shift_id: string | null;
  default_shift: Shift | null;
  notes: string | null;
  active: boolean;
  worker_count: number;
}

interface DeptForm {
  name: string;
  default_shift_id: string;
  notes: string;
  active: boolean;
}

const defaultForm: DeptForm = {
  name: "",
  default_shift_id: "",
  notes: "",
  active: true,
};

// ─── Dept Dialog ────────────────────────────────────────────────────────────────

function DeptDialog({
  open, onClose, dept,
}: { open: boolean; onClose: () => void; dept: Department | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<DeptForm>(defaultForm);

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["shifts"],
    queryFn: () => api.get("/shifts"),
    enabled: open,
  });

  const activeShifts = shifts.filter((s) => s.active);

  // Sync form when dialog opens
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm(dept ? {
        name: dept.name,
        default_shift_id: dept.default_shift_id ?? "",
        notes: dept.notes ?? "",
        active: dept.active,
      } : defaultForm);
    }
  }

  const set = (k: keyof DeptForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        default_shift_id: form.default_shift_id || null,
        notes: form.notes || null,
        active: form.active,
      };
      if (dept) return api.put(`/departments/${dept.id}`, body);
      return api.post("/departments", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast({ title: dept ? t("departments.updated") : t("departments.created") });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {dept ? t("departments.editDepartment") : t("departments.addDepartment")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("departments.departmentName")} *</Label>
            <Input
              value={form.name}
              placeholder={t("departments.namePlaceholder")}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("departments.defaultShift")}</Label>
            <Select
              value={form.default_shift_id || "__none__"}
              onValueChange={(v) => set("default_shift_id", v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("departments.noShift")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("departments.noShift")}</SelectItem>
                {activeShifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.start_time}–{s.end_time})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("departments.notes")}</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dept-active"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="dept-active">{t("departments.active")}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!form.name.trim() || mut.isPending}
          >
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {dept ? t("common.saveChanges") : t("departments.addDepartment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast({ title: t("departments.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const active = departments.filter((d) => d.active);
  const inactive = departments.filter((d) => !d.active);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="w-6 h-6" />
              {t("departments.title")}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">{t("departments.subtitle")}</p>
          </div>
          <Button onClick={() => { setEditDept(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            {t("departments.addDepartment")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="text-2xl font-bold">{active.length}</div>
            <div className="text-sm text-muted-foreground">Активни отдела</div>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="text-2xl font-bold">
              {departments.reduce((sum, d) => sum + (d.worker_count ?? 0), 0)}
            </div>
            <div className="text-sm text-muted-foreground">Общо работници</div>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Зареждане…
          </div>
        ) : departments.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            {t("departments.noDepartments")}
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("departments.departmentName")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("departments.defaultShift")}</th>
                  <th className="text-center px-4 py-3 font-medium">
                    <HardHat className="w-4 h-4 inline" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {departments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{dept.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {dept.default_shift ? (
                        <span className="text-foreground">
                          {dept.default_shift.name}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({dept.default_shift.start_time}–{dept.default_shift.end_time})
                          </span>
                        </span>
                      ) : (
                        <span className="italic">{t("departments.noShift")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="secondary">{dept.worker_count ?? 0}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={dept.active ? "default" : "outline"}>
                        {dept.active ? "Активен" : "Неактивен"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditDept(dept); setDialogOpen(true); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(dept)}
                          disabled={!dept.active}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeptDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        dept={editDept}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("departments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("departments.deleteDesc")} — <strong>{deleteTarget?.name}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {t("departments.deleteTitle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
