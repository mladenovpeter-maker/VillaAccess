import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AccessEvent } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import {
  Camera, ScanLine, CheckCircle2, XCircle, DoorOpen,
  Clock, Car, AlertTriangle, UserCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineStep {
  id: string;
  label: string;
  status: "success" | "error" | "warning" | "info" | "pending";
  timestamp: string | null;
  detail: string | null;
  icon: React.ElementType;
}

function buildTimeline(event: AccessEvent): TimelineStep[] {
  const steps: TimelineStep[] = [];

  // Step 1: Vehicle Detected
  steps.push({
    id: "detected",
    label: "Vehicle Detected",
    status: "success",
    timestamp: event.timestamp,
    detail: event.license_plate ? `Plate seen: ${event.license_plate}` : "Unknown plate",
    icon: Camera,
  });

  // Step 2: OCR Processing
  if (event.confidence_score != null) {
    const conf = Math.round(event.confidence_score * 100);
    steps.push({
      id: "ocr",
      label: "OCR Processed",
      status: conf >= 70 ? "success" : conf >= 40 ? "warning" : "error",
      timestamp: event.timestamp,
      detail: `Confidence: ${conf}% — plate: ${event.license_plate ?? "N/A"}`,
      icon: ScanLine,
    });
  } else {
    steps.push({
      id: "ocr",
      label: "OCR Processed",
      status: "info",
      timestamp: null,
      detail: "No confidence score recorded",
      icon: ScanLine,
    });
  }

  // Step 3: Vehicle Lookup
  if (event.vehicle_id) {
    steps.push({
      id: "vehicle_lookup",
      label: "Vehicle Identified",
      status: "success",
      timestamp: event.timestamp,
      detail: event.vehicle
        ? `${event.vehicle.license_plate}${event.vehicle.make ? ` — ${event.vehicle.make} ${event.vehicle.model ?? ""}` : ""}`
        : `Vehicle ID: ${event.vehicle_id.slice(0, 8)}`,
      icon: Car,
    });
  } else {
    steps.push({
      id: "vehicle_lookup",
      label: "Vehicle Lookup",
      status: event.status === "denied" ? "warning" : "info",
      timestamp: null,
      detail: "No matching vehicle in database",
      icon: Car,
    });
  }

  // Step 4: Reservation Check
  if (event.status === "allowed") {
    steps.push({
      id: "reservation",
      label: "Reservation Validated",
      status: "success",
      timestamp: event.timestamp,
      detail: "Active reservation found — access window open",
      icon: UserCheck,
    });
  } else if (event.status === "denied") {
    const code = (event as any).denial_code;
    steps.push({
      id: "reservation",
      label: "Reservation Check",
      status: "error",
      timestamp: event.timestamp,
      detail: code ? `Denied: ${code.replace(/_/g, " ")}` : event.notes ?? "No valid reservation found",
      icon: AlertTriangle,
    });
  } else if (event.status === "manual") {
    steps.push({
      id: "reservation",
      label: "Manual Override",
      status: "info",
      timestamp: event.timestamp,
      detail: event.notes ?? "Operator manually triggered",
      icon: UserCheck,
    });
  } else {
    steps.push({
      id: "reservation",
      label: "Reservation Check",
      status: "pending",
      timestamp: null,
      detail: "Pending validation",
      icon: Clock,
    });
  }

  // Step 5: Decision
  if (event.status === "allowed" || event.status === "manual") {
    steps.push({
      id: "decision",
      label: "Access Granted",
      status: "success",
      timestamp: event.timestamp,
      detail: event.status === "manual" ? "Operator override — gate opened" : "Automatic grant — gate opened",
      icon: CheckCircle2,
    });
    steps.push({
      id: "gate",
      label: "Gate Opened",
      status: "success",
      timestamp: event.timestamp,
      detail: event.entrance ? `Entrance: ${event.entrance.name}` : event.entrance_id ? `Entrance ID: ${event.entrance_id.slice(0, 8)}` : "Entrance unknown",
      icon: DoorOpen,
    });
  } else if (event.status === "denied") {
    steps.push({
      id: "decision",
      label: "Access Denied",
      status: "error",
      timestamp: event.timestamp,
      detail: "Gate not opened — access rejected",
      icon: XCircle,
    });
  } else {
    steps.push({
      id: "decision",
      label: "Decision Pending",
      status: "pending",
      timestamp: null,
      detail: "Awaiting resolution",
      icon: Clock,
    });
  }

  return steps;
}

const STATUS_STYLES: Record<string, { dot: string; line: string; icon: string; badge: string }> = {
  success: { dot: "bg-green-400 border-green-400/30 shadow-[0_0_8px_theme(colors.green.400)]", line: "border-green-400/30", icon: "text-green-400", badge: "bg-green-500/10 text-green-400 border-green-500/20" },
  error:   { dot: "bg-red-400 border-red-400/30 shadow-[0_0_8px_theme(colors.red.400)]",     line: "border-red-400/20",   icon: "text-red-400",   badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  warning: { dot: "bg-amber-400 border-amber-400/30 shadow-[0_0_8px_theme(colors.amber.400)]", line: "border-amber-400/20", icon: "text-amber-400", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  info:    { dot: "bg-blue-400 border-blue-400/30",                                            line: "border-border/40",   icon: "text-blue-400",  badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  pending: { dot: "bg-muted-foreground/40 border-border/40",                                  line: "border-border/20",   icon: "text-muted-foreground/40", badge: "bg-muted/50 text-muted-foreground border-border" },
};

function TimelineView({ event }: { event: AccessEvent }) {
  const steps = buildTimeline(event);
  const overallStatus = event.status === "allowed" || event.status === "manual" ? "success" : event.status === "denied" ? "error" : "pending";
  const statusColor = { success: "text-green-400", error: "text-red-400", pending: "text-amber-400" }[overallStatus];

  return (
    <div className="space-y-2">
      {/* Event header */}
      <div className="flex items-center gap-3 px-1">
        <div className={cn("w-2 h-2 rounded-full", overallStatus === "success" ? "bg-green-400" : overallStatus === "error" ? "bg-red-400" : "bg-amber-400")} />
        <span className="font-mono text-sm font-bold text-foreground">{event.license_plate ?? "Unknown"}</span>
        <span className={cn("text-xs font-semibold capitalize", statusColor)}>{event.status}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(event.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>

      {/* Steps */}
      <div className="relative pl-6">
        {steps.map((step, idx) => {
          const s = STATUS_STYLES[step.status];
          const Icon = step.icon;
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.id} className="relative flex gap-4 pb-4">
              {/* Vertical line */}
              {!isLast && (
                <div className={cn("absolute left-[7px] top-5 bottom-0 w-px border-l-2 border-dashed", s.line)} />
              )}
              {/* Dot */}
              <div className={cn("w-4 h-4 rounded-full border-2 shrink-0 mt-0.5", s.dot)} />
              {/* Content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon className={cn("w-3.5 h-3.5 shrink-0", s.icon)} />
                  <span className="text-sm font-medium text-foreground">{step.label}</span>
                  {step.timestamp && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(step.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  )}
                </div>
                {step.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5 ml-5">{step.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventTimelineCard({ event }: { event: AccessEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <button
          className="w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-2 h-2 rounded-full shrink-0",
              event.status === "allowed" ? "bg-green-400" : event.status === "denied" ? "bg-red-400" : "bg-blue-400"
            )} />
            <span className="font-mono text-sm font-semibold text-foreground">
              {event.license_plate ?? "Unknown"}
            </span>
            <span className={cn("text-xs capitalize font-medium", {
              "text-green-400": event.status === "allowed",
              "text-red-400": event.status === "denied",
              "text-blue-400": event.status === "manual",
              "text-amber-400": event.status === "pending",
            })}>
              {event.status}
            </span>
            {event.confidence_score != null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(event.confidence_score * 100)}% conf
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {new Date(event.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            {expanded
              ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
          </div>
        </button>

        {expanded && (
          <div className="mt-4 border-t border-border/50 pt-4">
            <TimelineView event={event} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TimelinePage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["timeline-events", statusFilter, page],
    queryFn: () => api.get<any>(`/access/events?page=${page}&page_size=20${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`),
    refetchInterval: 15000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / 20);

  return (
    <AppLayout title={t("timeline.title")} subtitle={t("timeline.subtitle")}>
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Filter */}
        <div className="flex gap-3 items-center">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="allowed">{t("access.status.allowed")}</SelectItem>
              <SelectItem value="denied">{t("access.status.denied")}</SelectItem>
              <SelectItem value="manual">{t("access.status.manual")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{data?.total ?? 0} {t("timeline.events")}</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : !data?.items.length ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">{t("timeline.noEvents")}</CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data.items.map((e: AccessEvent) => <EventTimelineCard key={e.id} event={e} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <button
              className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
              onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
            >← {t("common.previous")}</button>
            <span className="text-sm text-muted-foreground">{page}/{totalPages}</span>
            <button
              className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
            >{t("common.next")} →</button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
