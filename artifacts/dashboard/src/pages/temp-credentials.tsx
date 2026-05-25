import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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
  KeyRound, Plus, Trash2, Loader2, ShieldOff, Clock, CheckCircle2,
  XCircle, RefreshCw, Building2, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TempCred {
  id: string;
  reservation_id: string;
  pin_code: string;
  label: string | null;
  notes: string | null;
  valid_from: string;
  valid_until: string;
  status: "active" | "expired" | "revoked";
  created_at: string;
  reservation: { id: string; guest_name: string; villa_id: string; pin_code: string | null } | null;
  villa: { id: string; name: string } | null;
}

interface Reservation {
  id: string;
  guest_name: string;
  status: string;
  villa?: { name: string } | null;
}

interface CredForm {
  reservation_id: string;
  pin_code: string;
  label: string;
  notes: string;
  valid_from: string;
  valid_until: string;
}

function toInputDateTime(d: Date) {
  return d.toISOString().slice(0, 16);
}

const defaultForm = (): CredForm => {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { reservation_id: "", pin_code: "", label: "", notes: "", valid_from: toInputDateTime(now), valid_until: toInputDateTime(end) };
};

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatDate(d: string) {
  return new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
  if (status === "expired")
    return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15"><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
  return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15"><XCircle className="w-3 h-3 mr-1" />Revoked</Badge>;
}

// ─── Create Dialog ──────────────────────────────────────────────────────────────

function CreateCredDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<CredForm>(defaultForm());

  const { data: reservations = [] } = useQuery<Reservation[]>({
    queryKey: ["reservations-active"],
    queryFn: () => api.get("/reservations?status=active"),
    enabled: open,
  });

  const allReservations = useQuery<Reservation[]>({
    queryKey: ["reservations-all-for-creds"],
    queryFn: () => api.get("/reservations"),
    enabled: open,
  });

  const set = (k: keyof CredForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => api.post("/temp-credentials", {
      reservation_id: form.reservation_id,
      pin_code: form.pin_code || undefined,
      label: form.label || undefined,
      notes: form.notes || undefined,
      valid_from: new Date(form.valid_from).toISOString(),
      valid_until: new Date(form.valid_until).toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-credentials"] });
      toast({ title: t("tempCreds.created") });
      onClose();
      setForm(defaultForm());
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const allRes = allReservations.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />{t("tempCreds.generateAccess")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("tempCreds.reservation")} *</Label>
            <Select value={form.reservation_id} onValueChange={(v) => set("reservation_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("tempCreds.selectReservation")} />
              </SelectTrigger>
              <SelectContent>
                {allRes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.guest_name} {r.villa ? `· ${(r.villa as any).name ?? ""}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("tempCreds.label")}</Label>
            <Input
              placeholder={t("tempCreds.labelPlaceholder")}
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("tempCreds.pinCode")}</Label>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                onClick={() => set("pin_code", generatePin())}
              >
                <RefreshCw className="w-3 h-3" />{t("tempCreds.generate")}
              </button>
            </div>
            <Input
              placeholder={t("tempCreds.pinPlaceholder")}
              value={form.pin_code}
              onChange={(e) => set("pin_code", e.target.value)}
              maxLength={8}
              className="font-mono tracking-widest"
            />
            <p className="text-xs text-muted-foreground">{t("tempCreds.pinHint")}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("tempCreds.validFrom")} *</Label>
              <Input type="datetime-local" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("tempCreds.validUntil")} *</Label>
              <Input type="datetime-local" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.notes")}</Label>
            <Textarea
              placeholder={t("tempCreds.notesPlaceholder")}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!form.reservation_id || !form.valid_from || !form.valid_until || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("tempCreds.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function TempCredentialsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TempCred | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TempCred | null>(null);

  const { data: creds = [], isLoading } = useQuery<TempCred[]>({
    queryKey: ["temp-credentials", statusFilter],
    queryFn: () => api.get(`/temp-credentials${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`),
    refetchInterval: 30_000,
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.post(`/temp-credentials/${id}/revoke`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-credentials"] });
      toast({ title: t("tempCreds.revoked") });
      setRevokeTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/temp-credentials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["temp-credentials"] });
      toast({ title: t("tempCreds.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const activeCount = creds.filter((c) => c.status === "active").length;
  const expiredCount = creds.filter((c) => c.status === "expired").length;
  const revokedCount = creds.filter((c) => c.status === "revoked").length;

  const now = new Date();
  function isExpiringSoon(c: TempCred) {
    if (c.status !== "active") return false;
    const exp = new Date(c.valid_until);
    return exp > now && exp.getTime() - now.getTime() < 2 * 60 * 60 * 1000;
  }

  return (
    <AppLayout
      title={t("tempCreds.title")}
      subtitle={t("tempCreds.subtitle")}
      actions={
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />{t("tempCreds.generate")}
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("common.total"), value: creds.length, color: "text-foreground" },
            { label: "Active", value: activeCount, color: "text-emerald-400" },
            { label: "Expired", value: expiredCount, color: "text-amber-400" },
            { label: "Revoked", value: revokedCount, color: "text-red-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className={`text-xl md:text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />{t("common.loading")}
          </div>
        ) : creds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <KeyRound className="w-7 h-7 text-primary/60" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t("tempCreds.noCreds")}</p>
              <p className="text-sm text-muted-foreground">{t("tempCreds.noCredsDesc")}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />{t("tempCreds.generate")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {creds.map((cred) => (
              <div
                key={cred.id}
                className={cn(
                  "bg-card border rounded-xl p-4 flex flex-col gap-3 transition-colors",
                  isExpiringSoon(cred) ? "border-amber-500/40" : "border-border",
                  cred.status !== "active" && "opacity-70"
                )}
              >
                {/* PIN */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <KeyRound className="w-3.5 h-3.5 text-primary" />
                      <span className="font-mono text-xl md:text-2xl font-bold tracking-widest text-primary">{cred.pin_code}</span>
                    </div>
                    {cred.label && <div className="text-xs font-medium text-foreground">{cred.label}</div>}
                  </div>
                  <StatusBadge status={cred.status} />
                </div>

                {/* Reservation / Villa */}
                {(cred.reservation || cred.villa) && (
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {cred.reservation && (
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{cred.reservation.guest_name}</span>
                      </div>
                    )}
                    {cred.villa && (
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{cred.villa.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Validity */}
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t("tempCreds.validFrom")}</span>
                    <span className="font-medium text-foreground">{formatDate(cred.valid_from)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t("tempCreds.validUntil")}</span>
                    <span className={cn("font-medium", isExpiringSoon(cred) ? "text-amber-400" : "text-foreground")}>
                      {formatDate(cred.valid_until)}
                    </span>
                  </div>
                </div>

                {cred.notes && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2">{cred.notes}</p>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {cred.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border-amber-500/20"
                      onClick={() => setRevokeTarget(cred)}
                    >
                      <ShieldOff className="w-3.5 h-3.5" />{t("tempCreds.revoke")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20", cred.status === "active" ? "" : "flex-1")}
                    onClick={() => setDeleteTarget(cred)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateCredDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tempCreds.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tempCreds.revokeDesc")} <strong className="font-mono">{revokeTarget?.pin_code}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => revokeTarget && revokeMut.mutate(revokeTarget.id)}
            >
              {revokeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("tempCreds.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tempCreds.deleteDesc")} <strong className="font-mono">{deleteTarget?.pin_code}</strong>
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
