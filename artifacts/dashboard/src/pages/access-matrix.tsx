import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Grid3X3, Loader2, Check, X, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entrance } from "@/lib/api";

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

function fullName(w: Worker) { return `${w.first_name} ${w.last_name}`; }

// ─── Cell Component ────────────────────────────────────────────────────────────

function MatrixCell({
  workerId,
  entranceId,
  rule,
  shifts,
  onToggle,
  onShiftChange,
  loading,
}: {
  workerId: string;
  entranceId: string;
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
  const [loadingCells, setLoadingCells] = useState<Set<string>>(new Set());

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

  // Build rule lookup: `workerId|entranceId` → AccessRule
  const ruleMap = new Map<string, AccessRule>();
  rules.forEach((r) => ruleMap.set(`${r.worker_id}|${r.entrance_id}`, r));

  // Departments
  const departments = ["all", ...new Set(workers.map((w) => w.department).filter(Boolean) as string[])];

  const filteredWorkers = deptFilter === "all"
    ? workers.filter((w) => w.active)
    : workers.filter((w) => w.active && w.department === deptFilter);

  const activeEntrances = entrances.filter((e) => e.active);

  function cellKey(workerId: string, entranceId: string) { return `${workerId}|${entranceId}`; }

  function setLoading(key: string, on: boolean) {
    setLoadingCells((prev) => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  }

  async function handleToggle(workerId: string, entranceId: string) {
    const key = cellKey(workerId, entranceId);
    const existing = ruleMap.get(key);

    setLoading(key, true);
    try {
      if (existing) {
        // Non-destructive: flip active flag instead of deleting the rule
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

  async function handleShiftChange(workerId: string, entranceId: string, shiftId: string | null) {
    const key = cellKey(workerId, entranceId);
    setLoading(key, true);
    try {
      await api.post("/access-rules", { worker_id: workerId, entrance_id: entranceId, shift_id: shiftId });
      await qc.invalidateQueries({ queryKey: ["access-rules-matrix"] });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoading(key, false);
    }
  }

  const isLoading = loadingWorkers || loadingEntrances || loadingRules;

  // Stats
  const totalRules = rules.length;
  const workersWithAccess = new Set(rules.map((r) => r.worker_id)).size;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Grid3X3 className="w-6 h-6" />
            {t("matrix.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("matrix.subtitle")}</p>
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

        {/* Department filter */}
        <div className="flex gap-3 items-center">
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
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/30 z-10 min-w-48">
                    {t("workers.name")}
                  </th>
                  {activeEntrances.map((e) => (
                    <th key={e.id} className="px-3 py-3 font-medium text-muted-foreground text-center min-w-28">
                      <div className="text-xs leading-tight">{e.name}</div>
                      <Badge
                        className={cn(
                          "mt-1 text-[9px] px-1.5 py-0",
                          e.access_level === "public" && "bg-blue-500/15 text-blue-400 border-blue-500/20",
                          e.access_level === "restricted" && "bg-orange-500/15 text-orange-400 border-orange-500/20",
                          e.access_level === "admin_only" && "bg-red-500/15 text-red-400 border-red-500/20",
                        )}
                      >
                        {e.access_level}
                      </Badge>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.map((w) => (
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
                          workerId={w.id}
                          entranceId={e.id}
                          rule={ruleMap.get(key)}
                          shifts={shifts}
                          onToggle={() => handleToggle(w.id, e.id)}
                          onShiftChange={(shiftId) => handleShiftChange(w.id, e.id, shiftId)}
                          loading={loadingCells.has(key)}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
