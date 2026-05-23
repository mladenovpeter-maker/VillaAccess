import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  eventsApi,
  tokenStore,
  type DomainEvent,
  type EventStats,
} from "@/lib/api";
import {
  Car,
  DoorOpen,
  ShieldCheck,
  Brain,
  CalendarDays,
  Activity,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Users,
  AlertTriangle,
  Info,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_IDS = ["all", "vehicle", "gate", "access", "ai", "reservation"] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  all:         Activity,
  vehicle:     Car,
  gate:        DoorOpen,
  access:      ShieldCheck,
  ai:          Brain,
  reservation: CalendarDays,
};

const CATEGORY_COLORS: Record<string, string> = {
  vehicle:     "text-blue-400 bg-blue-400/10 border-blue-400/20",
  gate:        "text-amber-400 bg-amber-400/10 border-amber-400/20",
  access:      "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  ai:          "text-purple-400 bg-purple-400/10 border-purple-400/20",
  reservation: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
};

const CATEGORY_DOT: Record<string, string> = {
  vehicle:     "bg-blue-400",
  gate:        "bg-amber-400",
  access:      "bg-emerald-400",
  ai:          "bg-purple-400",
  reservation: "bg-cyan-400",
};

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; className: string }> = {
  info:     { icon: Info,          className: "text-muted-foreground" },
  warning:  { icon: AlertTriangle, className: "text-amber-400" },
  error:    { icon: XCircle,       className: "text-red-400" },
  critical: { icon: Zap,           className: "text-red-400 animate-pulse" },
};

const SOURCE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  camera:    "Camera",
  ai_worker: "AI Worker",
  api:       "API",
};

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Explicit local date + time, e.g. "May 23, 14:32:01" or
 *  "May 23, 2025, 14:32:01" if the event is from a previous year. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month:  "short",
    day:    "2-digit",
    year:   sameYear ? undefined : "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getCategoryIcon(category: string): React.ElementType {
  return CATEGORY_ICONS[category] ?? Activity;
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, isLive = false }: { event: DomainEvent; isLive?: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = getCategoryIcon(event.category);
  const severityConf  = SEVERITY_CONFIG[event.severity] ?? SEVERITY_CONFIG.info;
  const SeverityIcon  = severityConf.icon;
  const colorClass    = CATEGORY_COLORS[event.category] ?? "text-muted-foreground bg-muted/10";
  const hasPayload    = event.payload && Object.keys(event.payload).length > 0;

  const eventLabel = (t(`events.eventTypes.${event.event_type}`, { defaultValue: "" }) as string) ||
    event.event_type.replace(/\./g, " › ").replace(/_/g, " ");

  const severityLabel = (t(`events.eventTypes.${event.severity}`, { defaultValue: event.severity }) as string);

  // Extract human-readable description from payload. For ANPR events we
  // surface the match details (raw OCR text, similarity %, exact/partial,
  // and either the reason or relay outcome) so operators can see at a
  // glance why a plate was opened or denied.
  const description = (() => {
    const p = event.payload as Record<string, unknown> | null;
    if (!p) return null;

    const isAnpr =
      typeof event.event_type === "string" &&
      event.event_type.startsWith("anpr.");

    if (isAnpr) {
      const parts: string[] = [];
      const plate = (p.matched_plate || p.plate || p.license_plate) as
        | string
        | undefined;
      if (plate) parts.push(`Plate: ${plate}`);
      const raw = p.raw_ocr_text as string | null | undefined;
      if (raw && raw !== plate) parts.push(`raw "${raw}"`);
      const matchType = p.match_type as string | undefined;
      const sim = p.similarity_pct as number | undefined;
      if (matchType === "partial" && typeof sim === "number") {
        parts.push(`partial ${sim}%`);
      } else if (matchType === "exact") {
        parts.push("exact");
      }
      const conf = p.confidence as number | undefined;
      if (typeof conf === "number") parts.push(`conf ${conf.toFixed(0)}%`);
      const color = p.vehicle_color as string | null | undefined;
      if (color) parts.push(`color ${color}`);
      const reason = (p.decision_reason || p.reason) as string | undefined;
      if (event.event_type === "anpr.denied" && reason) {
        parts.push(`— ${reason}`);
      } else if (event.event_type === "anpr.allowed") {
        parts.push("— barrier opened");
      } else if (event.event_type === "anpr.relay_failed") {
        parts.push("— relay failed");
      }
      return parts.length ? parts.join(" · ") : null;
    }

    if (p.license_plate)  return `Plate: ${p.license_plate}`;
    if (p.guest_name)     return `Guest: ${p.guest_name}`;
    if (p.camera_name)    return `Camera: ${p.camera_name}`;
    if (p.operator)       return `Operator: ${p.operator}`;
    return null;
  })();

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/50 bg-card/50 px-4 py-3 transition-all",
        isLive && "border-l-2",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Category icon */}
        <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs", colorClass)}>
          <CategoryIcon className="h-3.5 w-3.5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{eventLabel}</span>
            {event.severity !== "info" && (
              <span className={cn("flex items-center gap-1 text-xs font-medium", severityConf.className)}>
                <SeverityIcon className="h-3 w-3" />
                {severityLabel}
              </span>
            )}
            <span
              className="ml-auto flex shrink-0 flex-col items-end text-xs text-muted-foreground"
              title={new Date(event.created_at).toLocaleString()}
            >
              <span>{relativeTime(event.created_at)}</span>
              <span className="text-[10px] tabular-nums opacity-80">
                {formatDateTime(event.created_at)}
              </span>
            </span>
          </div>

          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}

          {/* Ref chips */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", colorClass)}>
              {event.category}
            </Badge>
            {event.source && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                {SOURCE_LABELS[event.source] ?? event.source}
              </Badge>
            )}
            {event.vehicle_id && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-blue-400 border-blue-400/30">
                vehicle
              </Badge>
            )}
            {event.entrance_id && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                entrance
              </Badge>
            )}
            {event.camera_id && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                camera
              </Badge>
            )}
          </div>
        </div>

        {/* Expand payload toggle */}
        {hasPayload && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Expanded payload */}
      {expanded && hasPayload && (
        <div className="mt-2 ml-10 rounded-md bg-muted/30 p-3">
          <pre className="overflow-x-auto text-[11px] text-muted-foreground leading-relaxed">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats, sseConnected }: { stats: EventStats | undefined; sseConnected: boolean }) {
  const { t } = useTranslation();
  const cats = ["vehicle", "gate", "access", "ai", "reservation"] as const;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", sseConnected ? "bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" : "bg-muted-foreground")} />
        <span className="text-xs text-muted-foreground">
          {sseConnected ? t("events.liveLabel") : t("events.offlineLabel")}
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span className="font-medium text-foreground">{stats?.total ?? "—"}</span>
        <span>{t("events.eventsPerDay")}</span>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex flex-wrap gap-2">
        {cats.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", CATEGORY_DOT[cat])} />
            <span className="text-xs text-muted-foreground">{t(`events.categories.${cat}`)}</span>
            <span className="text-xs font-medium text-foreground">{stats?.by_category[cat] ?? 0}</span>
          </div>
        ))}
      </div>

      {stats && (
        <>
          <div className="h-4 w-px bg-border ml-auto" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>{stats.sse_clients} {t("events.connected")}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");
  const [liveEvents, setLiveEvents]         = useState<DomainEvent[]>([]);
  const [sseConnected, setSseConnected]     = useState(false);
  const [viewMode, setViewMode]             = useState<"live" | "history">("live");
  const [historyPage, setHistoryPage]       = useState(1);
  const esRef = useRef<EventSource | null>(null);

  // ── SSE connection ────────────────────────────────────────────────────────

  useEffect(() => {
    const token = tokenStore.getAccess();
    if (!token) return;

    function connect() {
      const url = eventsApi.streamUrl(token!, activeCategory !== "all" ? activeCategory : undefined);
      const es  = new EventSource(url);

      es.onopen = () => setSseConnected(true);
      es.onerror = () => { setSseConnected(false); };
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as DomainEvent & { type?: string };
          if (data.type === "connected") return;
          setLiveEvents((prev) => [data, ...prev].slice(0, 200));
        } catch { /* ignore parse errors */ }
      };

      esRef.current = es;
      return es;
    }

    const es = connect();
    return () => { es.close(); setSseConnected(false); esRef.current = null; };
  }, [activeCategory]);

  // ── REST queries ──────────────────────────────────────────────────────────

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["events-stats"],
    queryFn: eventsApi.stats,
    refetchInterval: 30_000,
  });

  const { data: history, isFetching: historyLoading } = useQuery({
    queryKey: ["events-history", activeCategory, historyPage],
    queryFn: () =>
      eventsApi.list({
        category: activeCategory !== "all" ? activeCategory : undefined,
        page:      historyPage,
        page_size: 30,
      }),
    enabled: viewMode === "history",
  });

  useEffect(() => setHistoryPage(1), [activeCategory]);

  const liveFiltered =
    activeCategory === "all"
      ? liveEvents
      : liveEvents.filter((e) => e.category === activeCategory);

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("events.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("events.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLiveEvents([]);
                void refetchStats();
              }}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("events.clear")}
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <StatsBar stats={stats} sseConnected={sseConnected} />

        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/50 bg-card/40 p-1">
          {CATEGORY_IDS.map((id) => {
            const Icon = CATEGORY_ICONS[id] ?? Activity;
            const label = t(`events.categories.${id}`);
            return (
              <button
                key={id}
                onClick={() => setActiveCategory(id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeCategory === id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {id !== "all" && liveEvents.filter((e) => e.category === id).length > 0 && (
                  <span className={cn(
                    "ml-0.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px]",
                    activeCategory === id ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {liveEvents.filter((e) => e.category === id).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* View toggle */}
        <div className="flex gap-2">
          <Button
            variant={viewMode === "live" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("live")}
          >
            <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", sseConnected ? "bg-emerald-400" : "bg-muted-foreground")} />
            {t("events.live")}
          </Button>
          <Button
            variant={viewMode === "history" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("history")}
          >
            {t("events.history")}
          </Button>
        </div>

        {/* ── LIVE FEED ───────────────────────────────────────────────────── */}
        {viewMode === "live" && (
          <div className="space-y-2">
            {!sseConnected && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-400">
                <WifiOff className="h-4 w-4 shrink-0" />
                {t("events.connecting")}
              </div>
            )}

            {sseConnected && liveFiltered.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card/20 py-12 text-center">
                <Wifi className="h-8 w-8 text-emerald-400/60" />
                <p className="text-sm font-medium text-foreground">{t("events.streamConnected")}</p>
                <p className="text-xs text-muted-foreground">{t("events.waitingForEvents")}</p>
              </div>
            )}

            {liveFiltered.map((event) => (
              <EventCard key={event.id} event={event} isLive />
            ))}
          </div>
        )}

        {/* ── HISTORY ─────────────────────────────────────────────────────── */}
        {viewMode === "history" && (
          <div className="space-y-2">
            {historyLoading && (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            )}

            {!historyLoading && history?.items.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("events.noEventsForCategory")}
              </div>
            )}

            {history?.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}

            {/* Pagination */}
            {history && history.total > 30 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  {t("events.totalEvents", { total: history.total })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="flex items-center px-2 text-sm text-muted-foreground">
                    {historyPage} / {Math.ceil(history.total / 30)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage >= Math.ceil(history.total / 30)}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
