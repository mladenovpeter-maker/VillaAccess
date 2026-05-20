import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { tokenStore } from "@/lib/api";
import { Download, CalendarDays, Car, ScrollText, ShieldCheck, FileJson, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ExportConfig {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  endpoint: string;
  color: string;
  filters: Array<{
    key: string;
    label: string;
    type: "date" | "select";
    options?: { value: string; label: string }[];
  }>;
}

const EXPORTS: ExportConfig[] = [
  {
    id: "reservations",
    label: "Reservations",
    description: "Guest reservations with villa, dates, PIN codes and status",
    icon: CalendarDays,
    endpoint: "/export/reservations",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    filters: [
      { key: "status", label: "Status", type: "select", options: [
        { value: "all", label: "All statuses" },
        { value: "upcoming", label: "Upcoming" },
        { value: "active", label: "Active" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ]},
      { key: "from", label: "From date", type: "date" },
      { key: "to", label: "To date", type: "date" },
    ],
  },
  {
    id: "vehicles",
    label: "Vehicles",
    description: "Vehicle database with plates, status, owner and visit history",
    icon: Car,
    endpoint: "/export/vehicles",
    color: "text-green-400 bg-green-500/10 border-green-500/20",
    filters: [
      { key: "status", label: "Status", type: "select", options: [
        { value: "all", label: "All statuses" },
        { value: "known", label: "Known" },
        { value: "unknown", label: "Unknown" },
        { value: "blacklisted", label: "Blacklisted" },
      ]},
    ],
  },
  {
    id: "access-events",
    label: "Access Events",
    description: "All gate access events with plate, confidence, entrance and outcome",
    icon: ShieldCheck,
    endpoint: "/export/access-events",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    filters: [
      { key: "status", label: "Status", type: "select", options: [
        { value: "all", label: "All statuses" },
        { value: "allowed", label: "Allowed" },
        { value: "denied", label: "Denied" },
        { value: "manual", label: "Manual" },
      ]},
      { key: "from", label: "From date", type: "date" },
      { key: "to", label: "To date", type: "date" },
    ],
  },
  {
    id: "logs",
    label: "System Logs",
    description: "All system logs — access, denied, override, system, AI",
    icon: ScrollText,
    endpoint: "/export/logs",
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    filters: [
      { key: "log_type", label: "Type", type: "select", options: [
        { value: "all", label: "All types" },
        { value: "access", label: "Access" },
        { value: "denied", label: "Denied" },
        { value: "override", label: "Override" },
        { value: "system", label: "System" },
        { value: "ai", label: "AI" },
      ]},
      { key: "from", label: "From date", type: "date" },
      { key: "to", label: "To date", type: "date" },
    ],
  },
];

function ExportCard({ config }: { config: ExportConfig }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<"csv" | "json" | null>(null);
  const Icon = config.icon;

  async function doExport(format: "csv" | "json") {
    setLoading(format);
    try {
      const token = tokenStore.getAccess();
      const filteredParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v && v !== "all") filteredParams[k] = v;
      }
      const qs = new URLSearchParams({ ...filteredParams, format });
      const res = await fetch(`${BASE}/api${config.endpoint}?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);

      const blob = await res.blob();
      const ext = format === "csv" ? "csv" : "json";
      const fname = `${config.id}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `${config.label} exported`, description: fname });
    } catch (err: any) {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center border", config.color)}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">{config.label}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {config.filters.map((f) => (
            <div key={f.key}>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">{f.label}</label>
              {f.type === "select" ? (
                <Select
                  value={params[f.key] ?? ""}
                  onValueChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={params[f.key] ?? ""}
                  onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={() => doExport("csv")}
            disabled={!!loading}
          >
            {loading === "csv"
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <FileText className="w-3.5 h-3.5" />}
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={() => doExport("json")}
            disabled={!!loading}
          >
            {loading === "json"
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <FileJson className="w-3.5 h-3.5" />}
            JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExportPage() {
  const { t } = useTranslation();

  return (
    <AppLayout title={t("export.title")} subtitle={t("export.subtitle")}>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-4 py-2.5">
          <Download className="w-4 h-4 shrink-0" />
          {t("export.hint")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {EXPORTS.map((config) => (
            <ExportCard key={config.id} config={config} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
