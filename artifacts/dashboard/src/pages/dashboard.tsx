import { useQuery } from "@tanstack/react-query";
import { dashboardApi, type AccessEvent } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  CalendarDays,
  Car,
  Camera,
  ShieldCheck,
  ShieldX,
  Zap,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

function StatCard({
  title,
  value,
  icon: Icon,
  color = "default",
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color?: "default" | "amber" | "green" | "red";
  loading?: boolean;
}) {
  const colors = {
    default: "bg-primary/10 text-primary",
    amber: "bg-amber-500/10 text-amber-400",
    green: "bg-green-500/10 text-green-400",
    red: "bg-red-500/10 text-red-400",
  };
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {title}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold text-foreground">{value}</p>
            )}
          </div>
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colors[color])}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    allowed: "bg-green-500/15 text-green-400 border-green-500/20",
    denied: "bg-red-500/15 text-red-400 border-red-500/20",
    manual: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function EventRow({ event }: { event: AccessEvent }) {
  const { t } = useTranslation();
  const ts = new Date(event.timestamp);
  const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = ts.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="w-2 h-2 rounded-full shrink-0 bg-primary/40" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            {event.license_plate ?? t("dashboard.unknownPlate")}
          </span>
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full border font-medium",
              statusBadge(event.status)
            )}
          >
            {event.status}
          </span>
          <span className="text-xs text-muted-foreground capitalize">
            {event.event_type?.replace("_", " ")}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-medium text-foreground">{timeStr}</div>
        <div className="text-xs text-muted-foreground">{dateStr}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const statsQ = useQuery({ queryKey: ["dashboard-stats"], queryFn: dashboardApi.stats, refetchInterval: 30000 });
  // Ask the server for allowed entries directly so a denied flood (e.g. a
  // heavily occluded plate emitting many denied reads) can never push the real
  // access activity out of the window and blank this panel. Denied events
  // remain available on the full Events page and in audit logs — the dashboard
  // feed is intentionally limited to allowed entries.
  const eventsQ = useQuery({
    queryKey: ["dashboard-events"],
    queryFn: () =>
      dashboardApi.recentEvents(15, { status: "allowed", event_type: "entry" }),
    refetchInterval: 10000,
  });
  const allowedEvents = (eventsQ.data ?? []).slice(0, 15);

  const s = statsQ.data;

  return (
    <AppLayout title={t("dashboard.title")} subtitle={t("dashboard.subtitle")}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={t("dashboard.activeVillas")} value={s?.total_villas ?? 0} icon={Building2} loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.reservations")} value={s?.active_reservations ?? 0} icon={CalendarDays} color="amber" loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.camerasOnline")} value={s?.cameras_online ?? 0} icon={Camera} color="green" loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.vehicles")} value={s?.total_vehicles ?? 0} icon={Car} loading={statsQ.isLoading} />
        </div>

        {/* Second row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={t("dashboard.eventsToday")} value={s?.events_today ?? 0} icon={Activity} loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.autoOpens")} value={s?.auto_opens_today ?? 0} icon={Zap} color="green" loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.deniedToday")} value={s?.denied_attempts_today ?? 0} icon={ShieldX} color="red" loading={statsQ.isLoading} />
          <StatCard title={t("dashboard.gatesOnline")} value={s?.gates_online ?? 0} icon={ShieldCheck} color="amber" loading={statsQ.isLoading} />
        </div>

        {/* Recent events */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              {t("dashboard.recentEvents")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {eventsQ.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : allowedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("dashboard.noEvents")}</p>
            ) : (
              <div>
                {allowedEvents.map((e) => <EventRow key={e.id} event={e} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
