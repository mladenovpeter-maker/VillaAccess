import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { logsApi, villasApi } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Activity, ShieldX, Settings, Brain, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const logTypeConfig: Record<string, { className: string; icon: React.ElementType }> = {
  access:   { className: "text-green-400",  icon: Activity },
  denied:   { className: "text-red-400",    icon: ShieldX },
  override: { className: "text-yellow-400", icon: AlertTriangle },
  system:   { className: "text-blue-400",   icon: Settings },
  ai:       { className: "text-purple-400", icon: Brain },
};

export default function LogsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [villaFilter, setVillaFilter] = useState("all");

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["logs", page, typeFilter, villaFilter],
    queryFn: () => logsApi.list({
      page,
      page_size: 50,
      ...(typeFilter !== "all" ? { log_type: typeFilter } : {}),
      ...(villaFilter !== "all" ? { villa_id: villaFilter } : {}),
    }),
    refetchInterval: 20000,
  });
  const { data: villas = [] } = useQuery({ queryKey: ["villas"], queryFn: () => import("@/lib/api").then(m => m.villasApi.list()) });

  const total = logsData?.total ?? 0;
  const totalPages = Math.ceil(total / 50);
  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));

  return (
    <AppLayout title={t("logs.title")} subtitle={t("logs.subtitle")}>
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder={t("logs.logType")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("logs.allTypes")}</SelectItem>
              <SelectItem value="access">{t("logs.types.access")}</SelectItem>
              <SelectItem value="denied">{t("logs.types.denied")}</SelectItem>
              <SelectItem value="override">{t("logs.types.override")}</SelectItem>
              <SelectItem value="system">{t("logs.types.system")}</SelectItem>
              <SelectItem value="ai">{t("logs.types.ai")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={villaFilter} onValueChange={(v) => { setVillaFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t("logs.allVillas")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("logs.allVillas")}</SelectItem>
              {villas.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{total.toLocaleString()} {t("logs.logEntries")}</span>
        </div>

        {/* Logs */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !logsData?.items.length ? (
              <div className="py-16 text-center text-muted-foreground">{t("logs.noLogs")}</div>
            ) : (
              <div className="divide-y divide-border/30 font-mono text-xs">
                {logsData.items.map((log) => {
                  const config = logTypeConfig[log.log_type] ?? logTypeConfig.system;
                  const Icon = config.icon;
                  return (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                      <span className="text-muted-foreground shrink-0 w-32 pt-0.5">
                        {new Date(log.timestamp).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <Icon className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", config.className)} />
                      <span className={cn("shrink-0 w-14 font-semibold uppercase", config.className)}>
                        [{log.log_type.toUpperCase()}]
                      </span>
                      <span className="flex-1 text-foreground/90 break-all">{log.message}</span>
                      {log.villa_id && (
                        <span className="text-muted-foreground shrink-0 hidden sm:block">{villaMap[log.villa_id] ?? log.villa_id}</span>
                      )}
                      {log.confidence_score != null && (
                        <span className="text-muted-foreground shrink-0">{Math.round(log.confidence_score * 100)}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">{t("logs.page")} {page} {t("logs.of")} {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
