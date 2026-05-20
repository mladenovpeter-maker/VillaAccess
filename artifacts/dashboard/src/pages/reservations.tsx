import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reservationsApi, villasApi, vehiclesApi, type Reservation, type Villa, type Vehicle } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Pencil, Trash2, CalendarDays, User, Car, Phone, Key,
  RefreshCw, ShieldOff, Wifi, WifiOff, AlertCircle, CheckCircle2,
  Clock, LogIn, LogOut, XCircle, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

// ─── Status helpers ───────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  upcoming:  "bg-blue-500/15 text-blue-400 border-blue-500/20",
  active:    "bg-green-500/15 text-green-400 border-green-500/20",
  completed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/20",
};

const syncColors: Record<string, string> = {
  pending:        "bg-amber-500/15 text-amber-400 border-amber-500/20",
  synced:         "bg-green-500/15 text-green-400 border-green-500/20",
  failed:         "bg-red-500/15 text-red-400 border-red-500/20",
  revoked:        "bg-muted text-muted-foreground border-border",
  not_applicable: "bg-muted text-muted-foreground border-border",
};

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
function formatDateTime(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function toInputDate(d: string) {
  return new Date(d).toISOString().slice(0, 10);
}

// ─── Form types ───────────────────────────────────────────────────────────────

interface ReservationFormData {
  guest_name: string; guest_phone: string; guest_email: string;
  villa_id: string; check_in: string; check_out: string;
  notes: string; vehicle_ids: string[];
}
const defaultForm: ReservationFormData = {
  guest_name: "", guest_phone: "", guest_email: "",
  villa_id: "", check_in: "", check_out: "", notes: "", vehicle_ids: [],
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReservationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [filter, setFilter]           = useState("all");
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [editTarget, setEditTarget]   = useState<Reservation | null>(null);
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [form, setForm]               = useState<ReservationFormData>(defaultForm);

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ["reservations", filter],
    queryFn: () => reservationsApi.list(filter !== "all" ? { status: filter } : undefined),
  });
  const { data: villas   = [] } = useQuery({ queryKey: ["villas"],   queryFn: villasApi.list });
  const { data: vehicles = [] } = useQuery({ queryKey: ["vehicles"], queryFn: vehiclesApi.list });

  // Refresh detail when mutations settle
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reservations"] });
    // Sync selected reservation from fresh data
    if (selectedRes) {
      qc.fetchQuery({ queryKey: ["reservation", selectedRes.id], queryFn: () => reservationsApi.get(selectedRes.id) })
        .then((r) => setSelectedRes(r)).catch(() => {});
    }
  };

  const createMut = useMutation({
    mutationFn: (data: ReservationFormData) => reservationsApi.create(data),
    onSuccess: () => { invalidate(); setDialogOpen(false); toast({ title: t("reservations.created") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReservationFormData }) => reservationsApi.update(id, data),
    onSuccess: (r) => { invalidate(); setDialogOpen(false); setSelectedRes(r); toast({ title: t("reservations.updated") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => reservationsApi.delete(id),
    onSuccess: () => { invalidate(); setSelectedRes(null); toast({ title: t("reservations.deleted") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const checkInMut = useMutation({
    mutationFn: (id: string) => reservationsApi.checkIn(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.checkedIn") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const checkOutMut = useMutation({
    mutationFn: (id: string) => reservationsApi.checkOut(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.checkedOut") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => reservationsApi.cancel(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.cancelledOk") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const regenPinMut = useMutation({
    mutationFn: (id: string) => reservationsApi.regeneratePin(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.pinRegenerated") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const forceSyncMut = useMutation({
    mutationFn: (id: string) => reservationsApi.forceSync(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.pinForceSynced") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });
  const revokePinMut = useMutation({
    mutationFn: (id: string) => reservationsApi.revokePin(id),
    onSuccess: (r) => { invalidate(); setSelectedRes(r); toast({ title: t("reservations.pinRevoked") }); },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  function openNew() {
    setEditTarget(null); setForm(defaultForm); setDialogOpen(true);
  }
  function openEdit(r: Reservation, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTarget(r);
    setForm({
      guest_name: r.guest_name, guest_phone: r.guest_phone ?? "", guest_email: r.guest_email ?? "",
      villa_id: r.villa_id, check_in: toInputDate(r.check_in), check_out: toInputDate(r.check_out),
      notes: r.notes ?? "", vehicle_ids: r.vehicle_ids,
    });
    setDialogOpen(true);
  }
  function handleSubmit() {
    if (editTarget) updateMut.mutate({ id: editTarget.id, data: form });
    else createMut.mutate(form);
  }

  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));
  const loading  = createMut.isPending || updateMut.isPending;
  const statusKeys = ["all", "upcoming", "active", "completed", "cancelled"] as const;

  return (
    <AppLayout
      title={t("reservations.title")}
      subtitle={t("reservations.subtitle")}
      actions={<Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-2" />{t("reservations.newReservation")}</Button>}
    >
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Status filters */}
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
              <Card
                key={r.id}
                className="hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => setSelectedRes(r)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground">{r.guest_name}</span>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", statusColors[r.status] ?? "")}>{r.status}</span>
                        {r.pin_sync_status && r.pin_sync_status !== "not_applicable" && (
                          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", syncColors[r.pin_sync_status] ?? "")}>
                            PIN: {r.pin_sync_status}
                          </span>
                        )}
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
                        {r.pin_code && <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" />PIN: {r.pin_code}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={(e) => openEdit(r, e)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(r.id); }} disabled={deleteMut.isPending}><Trash2 className="w-3.5 h-3.5" /></Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground self-center" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={!!selectedRes} onOpenChange={(o) => !o && setSelectedRes(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedRes && (
            <ReservationDetail
              reservation={selectedRes}
              villaMap={villaMap}
              vehicles={vehicles}
              onEdit={(r) => { openEdit(r, { stopPropagation: () => {} } as any); }}
              onCheckIn={() => checkInMut.mutate(selectedRes.id)}
              onCheckOut={() => checkOutMut.mutate(selectedRes.id)}
              onCancel={() => cancelMut.mutate(selectedRes.id)}
              onRegenPin={() => regenPinMut.mutate(selectedRes.id)}
              onForceSync={() => forceSyncMut.mutate(selectedRes.id)}
              onRevokePin={() => revokePinMut.mutate(selectedRes.id)}
              isCheckingIn={checkInMut.isPending}
              isCheckingOut={checkOutMut.isPending}
              isCancelling={cancelMut.isPending}
              isRegenPin={regenPinMut.isPending}
              isForceSync={forceSyncMut.isPending}
              isRevokePin={revokePinMut.isPending}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ── Create/Edit Dialog ───────────────────────────────────────────────── */}
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
    </AppLayout>
  );
}

// ─── Reservation Detail Sheet ─────────────────────────────────────────────────

interface DetailProps {
  reservation: Reservation;
  villaMap: Record<string, string>;
  vehicles: Vehicle[];
  onEdit: (r: Reservation) => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onCancel: () => void;
  onRegenPin: () => void;
  onForceSync: () => void;
  onRevokePin: () => void;
  isCheckingIn: boolean;
  isCheckingOut: boolean;
  isCancelling: boolean;
  isRegenPin: boolean;
  isForceSync: boolean;
  isRevokePin: boolean;
}

function ReservationDetail({
  reservation: r, villaMap, vehicles,
  onEdit, onCheckIn, onCheckOut, onCancel,
  onRegenPin, onForceSync, onRevokePin,
  isCheckingIn, isCheckingOut, isCancelling,
  isRegenPin, isForceSync, isRevokePin,
}: DetailProps) {
  const { t } = useTranslation();
  const guestVehicles = vehicles.filter((v) => r.vehicle_ids.includes(v.id));
  const canCheckIn  = ["upcoming"].includes(r.status);
  const canCheckOut = ["active", "upcoming"].includes(r.status);
  const canCancel   = !["completed", "cancelled"].includes(r.status);
  const canPinOps   = !["completed", "cancelled"].includes(r.status);

  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <User className="w-4 h-4" />
          {r.guest_name}
        </SheetTitle>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", statusColors[r.status] ?? "")}>{r.status}</span>
          {(r.villa as any)?.name && <span className="text-xs text-muted-foreground">{(r.villa as any).name}</span>}
        </div>
      </SheetHeader>

      {/* Guest info */}
      <Section title={t("reservations.guestDetail")}>
        <InfoRow label={t("reservations.checkIn")} value={formatDate(r.check_in)} />
        <InfoRow label={t("reservations.checkOut")} value={formatDate(r.check_out)} />
        {r.guest_phone && <InfoRow label={t("reservations.phone")} value={r.guest_phone} />}
        {r.guest_email && <InfoRow label={t("reservations.email")} value={r.guest_email} />}
        {r.notes && <InfoRow label={t("common.notes")} value={r.notes} />}
        {r.actual_check_in  && <InfoRow label="Checked in"  value={formatDateTime(r.actual_check_in)} />}
        {r.actual_check_out && <InfoRow label="Checked out" value={formatDateTime(r.actual_check_out)} />}
      </Section>

      {/* Lifecycle actions */}
      {(canCheckIn || canCheckOut || canCancel) && (
        <Section title={t("common.actions")}>
          <div className="flex gap-2 flex-wrap">
            {canCheckIn && (
              <Button size="sm" variant="outline" onClick={onCheckIn} disabled={isCheckingIn}>
                <LogIn className="w-3.5 h-3.5 mr-1.5" />{t("reservations.checkInAction")}
              </Button>
            )}
            {canCheckOut && (
              <Button size="sm" variant="outline" onClick={onCheckOut} disabled={isCheckingOut}>
                <LogOut className="w-3.5 h-3.5 mr-1.5" />{t("reservations.checkOutAction")}
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onCancel} disabled={isCancelling}>
                <XCircle className="w-3.5 h-3.5 mr-1.5" />{t("reservations.cancelAction")}
              </Button>
            )}
          </div>
        </Section>
      )}

      <Separator />

      {/* Access Credentials */}
      <Section title={t("reservations.accessCredentials")}>
        {/* PIN display */}
        <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("reservations.pinCode")}</span>
            <PinSyncBadge status={r.pin_sync_status} />
          </div>
          {r.pin_code ? (
            <div className="text-3xl font-mono font-bold tracking-[0.3em] text-foreground">{r.pin_code}</div>
          ) : (
            <div className="text-sm text-muted-foreground italic">{t("reservations.noPinSet")}</div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              <div className="font-medium text-foreground/70 mb-0.5">{t("reservations.validFrom")}</div>
              <div>{formatDateTime(r.pin_valid_from ?? r.check_in)}</div>
            </div>
            <div>
              <div className="font-medium text-foreground/70 mb-0.5">{t("reservations.validTo")}</div>
              <div>{formatDateTime(r.pin_valid_to ?? r.check_out)}</div>
            </div>
          </div>
          {r.pin_last_synced_at && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {t("reservations.lastSynced")}: {formatDateTime(r.pin_last_synced_at)}
            </div>
          )}
        </div>

        {/* PIN action buttons */}
        {canPinOps && (
          <div className="flex gap-2 flex-wrap mt-2">
            <Button size="sm" variant="outline" onClick={onRegenPin} disabled={isRegenPin}>
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isRegenPin && "animate-spin")} />
              {t("reservations.regeneratePin")}
            </Button>
            <Button size="sm" variant="outline" onClick={onForceSync} disabled={isForceSync || !r.pin_code}>
              <Wifi className="w-3.5 h-3.5 mr-1.5" />
              {t("reservations.forceSync")}
            </Button>
            <Button
              size="sm" variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={onRevokePin} disabled={isRevokePin || r.pin_sync_status === "revoked"}
            >
              <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
              {t("reservations.revokePin")}
            </Button>
          </div>
        )}
      </Section>

      {/* Assigned intercoms */}
      <Section title={t("reservations.assignedIntercoms")} count={r.assigned_intercoms?.length}>
        {(!r.assigned_intercoms || r.assigned_intercoms.length === 0) ? (
          <p className="text-sm text-muted-foreground">{t("reservations.noIntercoms")}</p>
        ) : (
          <div className="space-y-2">
            {r.assigned_intercoms.map((ic) => (
              <div key={ic.id} className="flex items-center justify-between rounded-lg bg-muted/30 border border-border px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {ic.status === "online" ? <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="font-medium truncate">{ic.name}</span>
                  <span className="text-xs text-muted-foreground hidden sm:block">{ic.ip_address}</span>
                </div>
                <IntercomSyncBadge status={ic.last_sync_status} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Vehicles */}
      {guestVehicles.length > 0 && (
        <Section title={t("reservations.vehiclesOptional")} count={guestVehicles.length}>
          <div className="space-y-2">
            {guestVehicles.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm rounded-lg bg-muted/30 border border-border px-3 py-2">
                <Car className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono font-medium">{v.license_plate}</span>
                {v.make && <span className="text-muted-foreground">{v.make} {v.model}</span>}
                {v.color && <span className="text-muted-foreground">· {v.color}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Edit button */}
      <div className="pt-2">
        <Button variant="outline" size="sm" className="w-full" onClick={() => onEdit(r)}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" />{t("reservations.editReservation")}
        </Button>
      </div>
    </div>
  );
}

// ─── Small helper components ──────────────────────────────────────────────────

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function PinSyncBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Pending", synced: "Synced", failed: "Failed",
    revoked: "Revoked", not_applicable: "N/A",
  };
  const icons: Record<string, React.ReactNode> = {
    pending:        <Clock className="w-3 h-3" />,
    synced:         <CheckCircle2 className="w-3 h-3" />,
    failed:         <AlertCircle className="w-3 h-3" />,
    revoked:        <ShieldOff className="w-3 h-3" />,
    not_applicable: <span />,
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1", syncColors[status] ?? syncColors.not_applicable)}>
      {icons[status]}
      {labels[status] ?? status}
    </span>
  );
}

function IntercomSyncBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">Never synced</span>;
  const colors: Record<string, string> = {
    success: "text-green-400",
    failed:  "text-red-400",
    revoked: "text-muted-foreground",
  };
  const icons: Record<string, React.ReactNode> = {
    success: <CheckCircle2 className="w-3 h-3" />,
    failed:  <AlertCircle className="w-3 h-3" />,
    revoked: <ShieldOff className="w-3 h-3" />,
  };
  return (
    <span className={cn("text-xs flex items-center gap-1 capitalize", colors[status] ?? "text-muted-foreground")}>
      {icons[status]}
      {status}
    </span>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Building2Icon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>;
}
