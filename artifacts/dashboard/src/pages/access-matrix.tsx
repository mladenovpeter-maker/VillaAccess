import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Grid3X3, Loader2, Check, X, Clock, Search,
  CheckSquare, XSquare, Upload, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entrance } from "@/lib/api";

interface ACSDeviceStatus {
  id: string;
  name: string;
  entrance_id: string | null;
  entrance_name: string | null;
  ip_address: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  status: string;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  department: string | null;
  active: boolean;
}

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  active: boolean;
}

interface AccessRule {
  id: string;
  worker_id: string;
  entrance_id: string;
  shift_id: string | null;
  active: boolean;
  worker?: Worker;
  shift?: Shift | null;
}

function fullName(w: Worker) { return `${w.last_name} ${w.first_name}`; }

// ─── Cell Component ────────────────────────────────────────────────────────────

function MatrixCell({
  rule,
  shifts,
  onToggle,
  onShiftChange,
  loading,
}: {
  rule: AccessRule | undefined;
  shifts: Shift[];
  onToggle: () => void;
  onShiftChange: (shiftId: string | null) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const hasAccess = !!rule && rule.active;

  return (
    <td className="px-2 py-2 text-center align-middle">
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={onToggle}
          disabled={loading}
          className={cn(
            "w-8 h-8 rounded-lg border transition-colors flex items-center justify-center",
            hasAccess
              ? "bg-green-500/20 border-green-500/40 text-green-400 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400"
              : "bg-muted/30 border-border text-muted-foreground hover:bg-green-500/10 hover:border-green-500/30 hover:text-green-400"
          )}
          title={hasAccess ? t("matrix.clickToRevoke") : t("matrix.clickToGrant")}
        >
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : hasAccess
              ? <Check className="w-3.5 h-3.5" />
              : <X className="w-3.5 h-3.5 opacity-40" />
          }
        </button>
        {hasAccess && shifts.length > 0 && (
          <div className="w-24">
            <Select
              value={rule.shift_id ?? "any"}
              onValueChange={(v) => onShiftChange(v === "any" ? null : v)}
            >
              <SelectTrigger className="h-6 text-[10px] px-1.5 border-dashed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">
                  <span className="flex items-center gap-1 text-xs">
                    <Clock className="w-3 h-3" />{t("matrix.allDay")}
                  </span>
                </SelectItem>
                {shifts.filter((s) => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="text-xs">{s.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </td>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function AccessMatrixPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loadingCells, setLoadingCells] = useState<Set<string>>(new Set());
  const [loadingCols, setLoadingCols] = useState<Set<string>>(new Set());
  const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const { data: workers = [], isLoading: loadingWorkers } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: () => api.get("/workers"),
  });

  const { data: entrances = [], isLoading: loadingEntrances } = useQuery<Entrance[]>({
    queryKey: ["entrances"],
    queryFn: () => api.get("/entrances"),
  });

  const { data: rules = [], isLoading: loadingRules } = useQuery<AccessRule[]>({
    queryKey: ["access-rules-matrix"],
    queryFn: () => api.get("/access-rules/matrix"),
  });

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["shifts"],
    queryFn: () => api.get("/shifts"),
  });

  const { data: acsStatus = [], refetch: refetchACS } = useQuery<ACSDeviceStatus[]>({
    queryKey: ["acs-status"],
    queryFn: () => api.get("/acs/status"),
    refetchInterval: 60_000,
  });

  async function handleSync(entranceId?: string) {
    setSyncing(true);
    try {
      const url = entranceId ? `/acs/sync/${entranceId}` : "/acs/sync";
      const result = await api.post(url, {});
      await refetchACS();
      const total = result.results?.reduce((s: number, r: any) => s + (r.synced ?? 0), 0) ?? 0;
      const failed = result.results?.reduce((s: number, r: any) => s + (r.failed?.length ?? 0), 0) ?? 0;
      toast({
        title: failed === 0 ? t("matrix.syncSuccess") : t("matrix.syncPartial"),
        description: `${total} ${t("matrix.syncCards")}${failed > 0 ? `, ${failed} ${t("matrix.syncFailed")}` : ""}`,
        variant: failed === 0 ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  // Build rule lookup: `workerId|entranceId` → AccessRule
  const ruleMap = new Map<string, AccessRule>();
  rules.forEach((r) => ruleMap.set(`${r.worker_id}|${r.entrance_id}`, r));

  // Departments
  const departments = ["all", ...new Set(workers.map((w) => w.department).filter(Boolean) as string[])];

  const filteredWorkers = workers
    .filter((w) => w.active)
    .filter((w) => deptFilter === "all" || w.department === deptFilter)
    .filter((w) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return fullName(w).toLowerCase().includes(q) || (w.employee_number ?? "").toLowerCase().includes(q);
    });

  const activeEntrances = entrances.filter((e) => e.active);

  // ── Stats (only active rules) ─────────────────────────────────────────────
  const activeRules = rules.filter((r) => r.active);
  const totalRules = activeRules.length;
  const workersWithAccess = new Set(activeRules.map((r) => r.worker_id)).size;

  function cellKey(workerId: string, entranceId: string) { return `${workerId}|${entranceId}`; }

  function setLoading(key: string, on: boolean) {
    setLoadingCells((prev) => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  }

  // ── Individual cell toggle ────────────────────────────────────────────────

  async function handleToggle(workerId: string, entranceId: string) {
    const key = cellKey(workerId, entranceId);
    const existing = ruleMap.get(key);

    setLoading(key, true);
    try {
      if (existing) {
        await api.patch(`/access-rules/${existing.id}`, { active: !existing.active });
      } else {
        await api.post("/access-rules", { worker_id: workerId, entrance_id: entranceId, shift_id: null });
      }
      await qc.invalidateQueries({ queryKey: ["access-rules-matrix"] });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoading(key, false);
    }
  }

  // ── Shift change (PATCH existing rule) ────────────────────────────────────

  async function handleShiftChange(workerId: string, entranceId: string, shiftId: string | null) {
    const key = cellKey(workerId, entranceId);
    const existing = ruleMap.get(key);
    setLoading(key, true);
    try {
      if (existing) {
        await api.patch(`/access-rules/${existing.id}`, { shift_id: shiftId });
      } else {
        await api.post("/access-rules", { worker_id: workerId, entrance_id: entranceId, shift_id: shiftId });
      }
      await qc.invalidateQueries({ queryKey: ["access-rules-matrix"] });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoading(key, false);
    }
  }

  // ── Bulk: column (all visible workers ↔ one entrance) ────────────────────

  async function handleColumnBulk(entranceId: string, grant: boolean) {
    setLoadingCols((prev) => new Set(prev).add(entranceId));
    try {
      await Promise.all(
        filteredWorkers.map(async (w) => {
          const existing = ruleMap.get(cellKey(w.id, entranceId));
          if (grant) {
            if (!existing) {
              await api.post("/access-rules", { worker_id: w.id, entrance_id: entranceId, shift_id: null });
            } else if (!existing.active) {
              await api.patch(`/access-rules/${existing.id}`, { active: true });
            }
          } else {
            if (existing?.active) {
              await api.patch(`/access-rules/${existing.id}`, { active: false });
            }
          }
        })
      );
      await qc.invalidateQueries({ queryKey: ["access-rules-matrix"] });
      toast({
        title: grant ? t("matrix.bulkGranted") : t("matrix.bulkRevoked"),
        description: `${filteredWorkers.length} ${t("matrix.workers")}`,
      });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoadingCols((prev) => { const next = new Set(prev); next.delete(entranceId); return next; });
    }
  }

  // ── Bulk: row (one worker ↔ all entrances) ───────────────────────────────

  async function handleRowBulk(workerId: string, grant: boolean) {
    setLoadingRows((prev) => new Set(prev).add(workerId));
    try {
      await Promise.all(
        activeEntrances.map(async (e) => {
          const existing = ruleMap.get(cellKey(workerId, e.id));
          if (grant) {
            if (!existing) {
              await api.post("/access-rules", { worker_id: workerId, entrance_id: e.id, shift_id: null });
            } else if (!existing.active) {
              await api.patch(`/access-rules/${existing.id}`, { active: true });
            }
          } else {
            if (existing?.active) {
              await api.patch(`/access-rules/${existing.id}`, { active: false });
            }
          }
        })
      );
      await qc.invalidateQueries({ queryKey: ["access-rules-matrix"] });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoadingRows((prev) => { const next = new Set(prev); next.delete(workerId); return next; });
    }
  }

  const isLoading = loadingWorkers || loadingEntrances || loadingRules;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Grid3X3 className="w-6 h-6" />
              {t("matrix.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("matrix.subtitle")}</p>
          </div>
          {/* Sync panel */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <button
              onClick={() => handleSync()}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {t("matrix.syncAll")}
            </button>
            {acsStatus.length > 0 && (
              <div className="flex flex-col items-end gap-0.5">
                {acsStatus.map((d) => (
                  <span key={d.id} className={cn(
                    "text-[10px] flex items-center gap-1",
                    d.last_sync_status?.startsWith("OK") ? "text-green-400" : d.last_sync_at ? "text-yellow-400" : "text-muted-foreground"
                  )}>
                    {d.last_sync_status && !d.last_sync_status.startsWith("OK") && <AlertCircle className="w-2.5 h-2.5" />}
                    <span className="font-medium">{d.entrance_name ?? d.name}:</span>
                    {d.last_sync_at
                      ? new Date(d.last_sync_at).toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : t("matrix.neverSynced")}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t("matrix.totalRules"), value: totalRules },
            { label: t("matrix.workersWithAccess"), value: workersWithAccess },
            { label: t("matrix.entrancesConfigured"), value: activeEntrances.length },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 w-52 text-sm"
              placeholder={t("common.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Department filter */}
          <span className="text-sm text-muted-foreground">{t("workers.department")}:</span>
          <div className="flex gap-2 flex-wrap">
            {departments.map((dept) => (
              <button
                key={dept}
                onClick={() => setDeptFilter(dept)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-medium border transition-colors",
                  deptFilter === dept
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
                )}
              >
                {dept === "all" ? t("common.all") : dept}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-green-500/20 border border-green-500/40 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-green-400" />
            </span>
            {t("matrix.accessGranted")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-muted/30 border border-border" />
            {t("matrix.noAccess")}
          </span>
          {shifts.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t("matrix.shiftRestricted")}
            </span>
          )}
          <span className="flex items-center gap-1.5 ml-2 text-blue-400">
            <CheckSquare className="w-3.5 h-3.5" />
            {t("matrix.bulkHint")}
          </span>
        </div>

        {/* Matrix table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />{t("common.loading")}
          </div>
        ) : filteredWorkers.length === 0 || activeEntrances.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {filteredWorkers.length === 0 ? t("workers.noWorkers") : t("matrix.noEntrances")}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-auto">
            <table className="text-sm min-w-max">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30 z-10 min-w-52">
                    {t("workers.name")}
                    <span className="ml-1 text-muted-foreground/50 font-normal text-[10px]">
                      ({filteredWorkers.length})
                    </span>
                  </th>
                  {activeEntrances.map((e) => {
                    const allGranted = filteredWorkers.every((w) => ruleMap.get(cellKey(w.id, e.id))?.active);
                    const colLoading = loadingCols.has(e.id);
                    return (
                      <th key={e.id} className="px-3 py-3 font-medium text-muted-foreground text-center min-w-32">
                        <div className="text-xs leading-tight">{e.name}</div>
                        {/* Column bulk buttons */}
                        <div className="flex justify-center gap-1 mt-1.5">
                          <button
                            onClick={() => handleColumnBulk(e.id, true)}
                            disabled={colLoading || allGranted}
                            title={t("matrix.grantAll")}
                            className="p-0.5 rounded text-green-400/70 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-30 transition-colors"
                          >
                            {colLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleColumnBulk(e.id, false)}
                            disabled={colLoading || !filteredWorkers.some((w) => ruleMap.get(cellKey(w.id, e.id))?.active)}
                            title={t("matrix.revokeAll")}
                            className="p-0.5 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
                          >
                            <XSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </th>
                    );
                  })}
                  {/* Extra column header for row bulk */}
                  <th className="px-3 py-3 text-center min-w-20">
                    <span className="text-[10px] text-muted-foreground/50">{t("matrix.allEntrances")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.map((w) => {
                  const rowLoading = loadingRows.has(w.id);
                  const allGrantedRow = activeEntrances.every((e) => ruleMap.get(cellKey(w.id, e.id))?.active);
                  return (
                    <tr key={w.id} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="px-4 py-2 sticky left-0 bg-card z-10">
                        <div className="font-medium leading-tight">{fullName(w)}</div>
                        {w.department && (
                          <div className="text-[10px] text-muted-foreground">{w.department}</div>
                        )}
                      </td>
                      {activeEntrances.map((e) => {
                        const key = cellKey(w.id, e.id);
                        return (
                          <MatrixCell
                            key={e.id}
                            rule={ruleMap.get(key)}
                            shifts={shifts}
                            onToggle={() => handleToggle(w.id, e.id)}
                            onShiftChange={(shiftId) => handleShiftChange(w.id, e.id, shiftId)}
                            loading={loadingCells.has(key) || rowLoading}
                          />
                        );
                      })}
                      {/* Row bulk buttons */}
                      <td className="px-3 py-2 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleRowBulk(w.id, true)}
                            disabled={rowLoading || allGrantedRow}
                            title={t("matrix.grantAll")}
                            className="p-0.5 rounded text-green-400/70 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-30 transition-colors"
                          >
                            {rowLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleRowBulk(w.id, false)}
                            disabled={rowLoading || !activeEntrances.some((e) => ruleMap.get(cellKey(w.id, e.id))?.active)}
                            title={t("matrix.revokeAll")}
                            className="p-0.5 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
                          >
                            <XSquare className="w-3.5 h-3.5" />
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

        {/* Filtered count hint */}
        {filteredWorkers.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {t("matrix.showing")} {filteredWorkers.length} / {workers.filter(w => w.active).length} {t("matrix.workers")}
          </p>
        )}
      </div>
    </AppLayout>
  );
}
