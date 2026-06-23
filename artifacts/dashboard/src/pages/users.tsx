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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Users, Plus, Pencil, Trash2, Loader2, Search, ShieldCheck,
  UserX, UserCheck, KeyRound, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SystemUser {
  id: string;
  username: string;
  role: "admin" | "operator";
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface UserForm {
  username: string;
  full_name: string;
  role: "admin" | "operator";
  password: string;
}

const defaultForm: UserForm = { username: "", full_name: "", role: "operator", password: "" };

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin")
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15"><ShieldCheck className="w-3 h-3 mr-1" />Admin</Badge>;
  if (role === "operator")
    return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/15">Operator</Badge>;
  return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15"><Eye className="w-3 h-3 mr-1" />Viewer</Badge>;
}

// ─── Create / Edit Dialog ───────────────────────────────────────────────────────

function UserDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: SystemUser | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [form, setForm] = useState<UserForm>(defaultForm);
  const [showPw, setShowPw] = useState(false);

  // Sync form whenever the dialog opens or the target user changes.
  // The dialog component stays mounted across opens, so useState's
  // initialiser only runs once — without this effect, opening the edit
  // modal for a real user keeps the previous form state (empty defaults
  // from the last create attempt), making the form look like a fresh
  // "Add user" instead of an edit. Same pattern as villas/entrances/
  // vehicles dialogs.
  useEffect(() => {
    if (!open) return;
    setForm(user ? {
      username:  user.username,
      full_name: user.full_name ?? "",
      role:      user.role,
      password:  "",
    } : defaultForm);
    setShowPw(false);
  }, [open, user]);

  const set = (k: keyof UserForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      if (user) {
        const body: Record<string, unknown> = { role: form.role, full_name: form.full_name || null };
        if (form.username !== user.username) body.username = form.username;
        return api.put(`/users/${user.id}`, body);
      }
      return api.post("/users", { username: form.username, password: form.password, role: form.role, full_name: form.full_name || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: user ? t("users.updated") : t("users.created") });
      onClose();
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const isValid = form.username.length >= 3 && (user || form.password.length >= 6);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? t("users.editUser") : t("users.createUser")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("users.username")} *</Label>
              <Input
                placeholder="john.doe"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("users.role")}</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("users.fullName")}</Label>
            <Input placeholder="John Doe" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          {!user && (
            <div className="space-y-1.5">
              <Label>{t("users.password")} *</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="Min. 6 characters"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPw(!showPw)}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          {user && (
            <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              {t("users.passwordHint")}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={!isValid || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {user ? t("common.saveChanges") : t("users.createUser")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset Password Dialog ──────────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose }: { user: SystemUser | null; onClose: () => void }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const mut = useMutation({
    mutationFn: () => api.post(`/users/${user!.id}/reset-password`, { password }),
    onSuccess: () => {
      toast({ title: t("users.passwordReset") });
      onClose();
      setPassword("");
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />{t("users.resetPassword")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">{t("users.resetPasswordFor")} <strong>{user?.username}</strong></p>
          <div className="space-y-1.5">
            <Label>{t("users.newPassword")} *</Label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPw(!showPw)}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={password.length < 6 || mut.isPending}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("users.resetPassword")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SystemUser | null>(null);
  const [resetTarget, setResetTarget] = useState<SystemUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemUser | null>(null);

  const { data: users = [], isLoading } = useQuery<SystemUser[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const toggleActiveMut = useMutation({
    mutationFn: (u: SystemUser) => api.post(`/users/${u.id}/${u.is_active ? "deactivate" : "activate"}`, {}),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: u.is_active ? t("users.deactivated") : t("users.activated") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: t("users.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const filtered = users.filter((u) => {
    const matchSearch = !search || u.username.toLowerCase().includes(search.toLowerCase()) || (u.full_name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const operatorCount = users.filter((u) => u.role === "operator").length;

  function openCreate() { setEditTarget(null); setDialogOpen(true); }
  function openEdit(u: SystemUser) { setEditTarget(u); setDialogOpen(true); }

  return (
    <AppLayout
      title={t("users.title")}
      subtitle={t("users.subtitle")}
      actions={
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />{t("users.createUser")}
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("users.totalUsers"), value: users.length, color: "text-foreground" },
            { label: t("users.active"), value: activeCount, color: "text-emerald-400" },
            { label: "Admins", value: adminCount, color: "text-red-400" },
            { label: "Operators", value: operatorCount, color: "text-blue-400" },
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
              placeholder={t("users.searchUsers")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> {t("common.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Users className="w-7 h-7 text-primary/60" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t("users.noUsers")}</p>
              <p className="text-sm text-muted-foreground">{t("users.noUsersDesc")}</p>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3 font-medium">{t("users.username")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("users.fullName")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("users.role")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("common.status")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("users.created")}</th>
                    <th className="text-right px-4 py-3 font-medium">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u, i) => (
                    <tr key={u.id} className={cn("border-b border-border last:border-0 hover:bg-muted/30 transition-colors", !u.is_active && "opacity-60")}>
                      <td className="px-4 py-3 font-mono font-medium text-foreground">{u.username}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.full_name ?? "—"}</td>
                      <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                      <td className="px-4 py-3">
                        {u.is_active
                          ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15">{t("users.active")}</Badge>
                          : <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/15">{t("users.inactive")}</Badge>
                        }
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5 text-xs" onClick={() => openEdit(u)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5 text-xs" onClick={() => setResetTarget(u)}>
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-8 px-2 gap-1.5 text-xs", u.is_active ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10" : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10")}
                            onClick={() => toggleActiveMut.mutate(u)}
                          >
                            {u.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Role legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-red-400" /> <strong className="text-foreground">Admin</strong> — full platform access</div>
          <div className="flex items-center gap-1.5"><div className="w-3.5 h-3.5 rounded-sm bg-blue-500/20 border border-blue-500/20" /> <strong className="text-foreground">Operator</strong> — manage access, override gates</div>
          <div className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-zinc-400" /> <strong className="text-foreground">Viewer</strong> — read-only</div>
        </div>
      </div>

      <UserDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditTarget(null); }} user={editTarget} />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("users.deleteDesc")} <strong>{deleteTarget?.username}</strong>?
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
