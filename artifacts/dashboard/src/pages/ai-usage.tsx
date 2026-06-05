import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { Sparkles, DoorOpen, ShieldX, CircleDollarSign, Info } from "lucide-react";

interface AiUsage {
  est_usd_per_call: number;
  month: { calls: number; opened: number; denied: number; est_usd: number };
  today: { calls: number; est_usd: number };
  daily: { day: string; calls: number; est_usd: number }[];
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold font-mono text-foreground">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AiUsagePage() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery<AiUsage>({
    queryKey: ["ai-usage"],
    queryFn: () => api.get("/ai-usage"),
    refetchInterval: 60000,
  });

  const usd = (n: number) => `$${n.toFixed(2)}`;
  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.calls)) : 1;

  return (
    <AppLayout title={t("aiUsage.title")} subtitle={t("aiUsage.subtitle")}>
      <div className="max-w-5xl mx-auto space-y-6">
        {isLoading || !data ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Top stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<Sparkles className="w-5 h-5 text-primary" />}
                label={t("aiUsage.monthCalls")}
                value={data.month.calls}
                sub={`${t("aiUsage.estimated")} ${usd(data.month.est_usd)}`}
              />
              <StatCard
                icon={<CircleDollarSign className="w-5 h-5 text-green-400" />}
                label={t("aiUsage.todayCalls")}
                value={data.today.calls}
                sub={`${t("aiUsage.estimated")} ${usd(data.today.est_usd)}`}
              />
              <StatCard
                icon={<DoorOpen className="w-5 h-5 text-green-400" />}
                label={t("aiUsage.openedByAi")}
                value={data.month.opened}
                sub={t("aiUsage.thisMonth")}
              />
              <StatCard
                icon={<ShieldX className="w-5 h-5 text-red-400" />}
                label={t("aiUsage.deniedByAi")}
                value={data.month.denied}
                sub={t("aiUsage.thisMonth")}
              />
            </div>

            {/* Estimate disclaimer */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {t("aiUsage.disclaimer", {
                  rate: usd(data.est_usd_per_call),
                })}
              </span>
            </div>

            {/* Daily breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("aiUsage.last14Days")}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.daily.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {t("aiUsage.noUsage")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.daily.map((d) => (
                      <div key={d.day} className="flex items-center gap-3">
                        <div className="w-24 text-xs font-mono text-muted-foreground shrink-0">
                          {d.day}
                        </div>
                        <div className="flex-1 h-5 rounded bg-muted/30 overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded"
                            style={{ width: `${(d.calls / maxDaily) * 100}%` }}
                          />
                        </div>
                        <div className="w-12 text-right text-sm font-mono text-foreground shrink-0">
                          {d.calls}
                        </div>
                        <div className="w-16 text-right text-xs font-mono text-muted-foreground shrink-0">
                          {usd(d.est_usd)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
