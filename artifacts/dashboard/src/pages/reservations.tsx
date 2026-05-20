import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reservationsApi, villasApi, vehiclesApi, type Reservation, type Villa, type Vehicle } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, CalendarDays, User, Car, Phone, Key } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

const statusColors: Record<string, string> = {
  upcoming: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  completed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/20",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

interface ReservationFormData {
  guest_name: string;
  guest_phone: string;
  guest_email: string;
  villa_id: string;
  check_in: string;
  check_out: string;
  notes: string;
  vehicle_ids: string[];
}

const defaultForm: ReservationFormData = {
  guest_name: "", guest_phone: "", guest_email: "",
  villa_id: "", check_in: "", check_out: "", notes: "", vehicle_ids: [],
};

function toInputDate(d: string) {
  return new Date(d).toISOString().slice(0, 10);
}

export default function ReservationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [filter, setFilter] = useState("all");
  const [editTarget, setEditTarget] = useState<Reservation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ReservationFormData>(defaultForm);

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ["reservations", filter],
    queryFn: () => reservationsApi.list(filter !== "all" ? { status: filter } : undefined),
  });
  const { data: villas = [] } = useQuery({ queryKey: ["villas"], queryFn: villasApi.list });
  const { data: vehicles = [] } = useQuery({ queryKey: ["vehicles"], queryFn: vehiclesApi.list });

  const createMut = useMutation({
    mutationFn: (data: ReservationFormData) => reservationsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); setDialogOpen(false); toast({ title: t("reservations.created") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReservationFormData }) => reservationsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); setDialogOpen(false); toast({ title: t("reservations.updated") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => reservationsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); toast({ title: t("reservations.deleted") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  function openNew() {
    setEditTarget(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }
  function openEdit(r: Reservation) {
    setEditTarget(r);
    setForm({
      guest_name: r.guest_name, guest_phone: r.guest_phone ?? "", guest_email: r.guest_email ?? "",
      villa_id: r.villa_id, check_in: toInputDate(r.check_in), check_out: toInputDate(r.check_out),
      notes: r.notes ?? "", vehicle_ids: r.vehicle_ids,
    });
    setDialogOpen(true);
  }
  function handleSubmit() {
    const payload = { ...form, vehicle_ids: form.vehicle_ids };
    if (editTarget) updateMut.mutate({ id: editTarget.id, data: payload });
    else createMut.mutate(payload);
  }

  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));
  const loading = createMut.isPending || updateMut.isPending;

  const statusKeys = ["all", "upcoming", "active", "completed", "cancelled"] as const;

  return (
    <AppLayout
      title={t("reservations.title")}
      subtitle={t("reservations.subtitle")}
      actions={<Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-2" />{t("reservations.newReservation")}</Button>}
    >
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {statusKeys.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize",
                filter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {t(`reservations.status.${s}`)}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : reservations.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">{t("reservations.noReservations")}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {reservations.map((r) => (
              <Card key={r.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground">{r.guest_name}</span>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", statusColors[r.status] ?? "")}>{r.status}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1.5"><Building2Icon className="w-3.5 h-3.5" />{villaMap[r.villa_id] ?? r.villa_id}</span>
                        <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{formatDate(r.check_in)} → {formatDate(r.check_out)}</span>
                        {r.guest_phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{r.guest_phone}</span>}
                        {r.vehicle_ids.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <Car className="w-3.5 h-3.5" />
                            {r.vehicle_ids.length} {r.vehicle_ids.length === 1 ? t("reservations.vehicle_one") : t("reservations.vehicle_other")}
                          </span>
                        )}
                        {r.pin_code && <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" />{t("reservations.pin")}: {r.pin_code}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteMut.mutate(r.id)} disabled={deleteMut.isPending}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-screen overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editTarget ? t("reservations.editReservation") : t("reservations.newReservation")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <FormField label={t("reservations.guestName")}>
                <Input value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} placeholder={t("reservations.fullName")} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t("reservations.phone")}>
                  <Input value={form.guest_phone} onChange={(e) => setForm({ ...form, guest_phone: e.target.value })} placeholder="+359..." />
                </FormField>
                <FormField label={t("reservations.email")}>
                  <Input value={form.guest_email} onChange={(e) => setForm({ ...form, guest_email: e.target.value })} placeholder="email@..." type="email" />
                </FormField>
              </div>
              <FormField label={t("reservations.villa")}>
                <Select value={form.villa_id} onValueChange={(v) => setForm({ ...form, villa_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t("reservations.selectVilla")} /></SelectTrigger>
                  <SelectContent>
                    {villas.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t("reservations.checkIn")}>
                  <Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} />
                </FormField>
                <FormField label={t("reservations.checkOut")}>
                  <Input type="date" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} />
                </FormField>
              </div>
              <FormField label={t("reservations.vehiclesOptional")}>
                <div className="border border-border rounded-lg max-h-36 overflow-y-auto p-2 space-y-1">
                  {vehicles.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={form.vehicle_ids.includes(v.id)}
                        onChange={(e) => setForm({ ...form, vehicle_ids: e.target.checked ? [...form.vehicle_ids, v.id] : form.vehicle_ids.filter((id) => id !== v.id) })}
                      />
                      <span>{v.license_plate}</span>
                      {v.make && <span className="text-muted-foreground">{v.make} {v.model}</span>}
                    </label>
                  ))}
                </div>
              </FormField>
              <FormField label={t("common.notes")}>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("reservations.optionalNotes")} />
              </FormField>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={loading || !form.guest_name || !form.villa_id || !form.check_in || !form.check_out}>
                {loading ? t("common.saving") : editTarget ? t("common.update") : t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

function Building2Icon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}
