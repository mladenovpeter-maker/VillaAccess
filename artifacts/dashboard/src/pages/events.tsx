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

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "all",         label: "All",         icon: Activity },
  { id: "vehicle",     label: "Vehicle",     icon: Car },
  { id: "gate",        label: "Gate",        icon: DoorOpen },
  { id: "access",      label: "Access",      icon: ShieldCheck },
  { id: "ai",          label: "AI",          icon: Brain },
  { id: "reservation", label: "Reservation", icon: CalendarDays },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

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

const SEVERITY_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  info:     { label: "Info",     icon: Info,          className: "text-muted-foreground" },
  warning:  { label: "Warning",  icon: AlertTriangle,  className: "text-amber-400" },
  error:    { label: "Error",    icon: XCircle,        className: "text-red-400" },
  critical: { label: "Critical", icon: Zap,            className: "text-red-400 animate-pulse" },
};

const SOURCE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  camera:    "Camera",
  ai_worker: "AI Worker",
  api:       "API",
};

// ─── Event type → human label ─────────────────────────────────────────────────

function formatEventType(type: string): string {
  const map: Record<string, string> = {
    "vehicle.created":          "Vehicle Added",
    "vehicle.updated":          "Vehicle Updated",
    "vehicle.detected":         "Vehicle Detected",
    "vehicle.recognized":       "Vehicle Recognized",
    "vehicle.unrecognized":     "Vehicle Not Recognized",
    "vehicle.blacklisted":      "Vehicle Blacklisted",
    "vehicle.unblacklisted":    "Vehicle Cleared",
    "gate.opened":              "Gate Opened",
    "gate.failed":              "Gate Failed",
    "gate.door_opened":         "Door Opened",
    "gate.door_failed":         "Door Failed",
    "access.granted":           "Access Granted",
    "access.denied":            "Access Denied",
    "access.manual_override":   "Manual Override",
    "ai.snapshot_uploaded":     "Snapshot Uploaded",
    "ai.plate_read":            "Plate Read",
    "ai.confidence_low":        "Low Confidence",
    "ai.fingerprint_updated":   "Fingerprint Updated",
    "ai.recognition_complete":  "Recognition Complete",
    "reservation.created":      "Reservation Created",
    "reservation.updated":      "Reservation Updated",
    "reservation.checked_in":   "Guest Checked In",
    "reservation.checked_out":  "Guest Checked Out",
    "reservation.cancelled":    "Reservation Cancelled",
    "reservation.expired":      "Reservation Expired",
  };
  return map[type] ?? type.replace(/\./g, " › ").replace(/_/g, " ");
}

function getCategoryIcon(category: string): React.ElementType {
  const map: Record<string, React.ElementType> = {
    vehicle:     Car,
    gate:        DoorOpen,
    access:      ShieldCheck,
    ai:          Brain,
    reservation: CalendarDays,
  };
  return map[category] ?? Activity;
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, isLive = false }: { event: DomainEvent; isLive?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = getCategoryIcon(event.category);
  const severityConf  = SEVERITY_CONFIG[event.severity] ?? SEVERITY_CONFIG.info;
  const SeverityIcon  = severityConf.icon;
  const colorClass    = CATEGORY_COLORS[event.category] ?? "text-muted-foreground bg-muted/10";
  const hasPayload    = event.payload && Object.keys(event.payload).length > 0;

  // Extract human-readable description from payload
  const description = (() => {
    const p = event.payload as Record<string, unknown> | null;
    if (!p) return null;
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
        isLive && CATEGORY_DOT[event.category] && `border-l-${event.category}`,
      )}
      style={isLive ? { borderLeftColor: undefined } : undefined}
    >
      <div className="flex items-start gap-3">
        {/* Category icon */}
        <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs", colorClass)}>
          <CategoryIcon className="h-3.5 w-3.5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {formatEventType(event.event_type)}
            </span>
            {event.severity !== "info" && (
              <span className={cn("flex items-center gap-1 text-xs font-medium", severityConf.className)}>
                <SeverityIcon className="h-3 w-3" />
                {severityConf.label}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {relativeTime(event.created_at)}
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
            {event.villa_id && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                villa
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
  const cats = ["vehicle", "gate", "access", "ai", "reservation"] as const;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", sseConnected ? "bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" : "bg-muted-foreground")} />
        <span className="text-xs text-muted-foreground">
          {sseConnected ? "Live" : "Offline"}
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span className="font-medium text-foreground">{stats?.total ?? "—"}</span>
        <span>events / 24h</span>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex flex-wrap gap-2">
        {cats.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", CATEGORY_DOT[cat])} />
            <span className="text-xs text-muted-foreground capitalize">{cat}</span>
            <span className="text-xs font-medium text-foreground">{stats?.by_category[cat] ?? 0}</span>
          </div>
        ))}
      </div>

      {stats && (
        <>
          <div className="h-4 w-px bg-border ml-auto" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>{stats.sse_clients} connected</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EventsPage() {
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
          if (data.type === "connected") return; // handshake message
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

  // Reset page when switching category
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
            <h1 className="text-xl font-bold text-foreground">Event Stream</h1>
            <p className="text-sm text-muted-foreground">
              Real-time domain event bus — all 5 categories
            </p>
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
              Clear
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <StatsBar stats={stats} sseConnected={sseConnected} />

        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/50 bg-card/40 p-1">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
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
          ))}
        </div>

        {/* View toggle */}
        <div className="flex gap-2">
          <Button
            variant={viewMode === "live" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("live")}
          >
            <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", sseConnected ? "bg-emerald-400" : "bg-muted-foreground")} />
            Live Feed
          </Button>
          <Button
            variant={viewMode === "history" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("history")}
          >
            History
          </Button>
        </div>

        {/* ── LIVE FEED ───────────────────────────────────────────────────── */}
        {viewMode === "live" && (
          <div className="space-y-2">
            {!sseConnected && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-400">
                <WifiOff className="h-4 w-4 shrink-0" />
                Connecting to event stream…
              </div>
            )}

            {sseConnected && liveFiltered.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card/20 py-12 text-center">
                <Wifi className="h-8 w-8 text-emerald-400/60" />
                <p className="text-sm font-medium text-foreground">Stream connected</p>
                <p className="text-xs text-muted-foreground">
                  Waiting for events — trigger a gate, create a vehicle, or open a reservation to see them here.
                </p>
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
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            )}

            {!historyLoading && history?.items.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No events recorded yet for this category.
              </div>
            )}

            {history?.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}

            {/* Pagination */}
            {history && history.total > 30 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  {history.total} total events
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    Previous
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
                    Next
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
