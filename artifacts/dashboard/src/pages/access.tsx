import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { accessApi, villasApi, type Villa, type AccessEvent } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DoorOpen, ShieldCheck, AlertTriangle, Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  allowed: "bg-green-500/15 text-green-400 border-green-500/20",
  denied: "bg-red-500/15 text-red-400 border-red-500/20",
  manual: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
};

export default function AccessControlPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [villaFilter, setVillaFilter] = useState("all");
  const [gateDialog, setGateDialog] = useState<{ type: "gate" | "door"; villa: Villa } | null>(null);

  const { data: villas = [] } = useQuery({ queryKey: ["villas"], queryFn: villasApi.list });
  const { data: eventsData, isLoading, refetch } = useQuery({
    queryKey: ["access-events", page, statusFilter, villaFilter],
    queryFn: () => accessApi.events({
      page,
      page_size: 25,
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      ...(villaFilter !== "all" ? { villa_id: villaFilter } : {}),
    }),
    refetchInterval: 15000,
  });

  const gateAction = useMutation({
    mutationFn: ({ type, villa_id }: { type: "gate" | "door"; villa_id: string }) =>
      type === "gate" ? accessApi.openGate(villa_id) : accessApi.openDoor(villa_id),
    onSuccess: (_, { type }) => {
      toast({ title: `${type === "gate" ? "Gate" : "Door"} opened`, description: "Command sent successfully." });
      setGateDialog(null);
      refetch();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const total = eventsData?.total ?? 0;
  const totalPages = Math.ceil(total / 25);
  const villaMap = Object.fromEntries(villas.map((v) => [v.id, v.name]));

  return (
    <AppLayout title="Access Control" subtitle="Gate events and manual controls">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Manual controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Manual Gate Control
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {villas.slice(0, 8).map((v) => (
                <div key={v.id} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="text-sm font-medium text-foreground truncate">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{v.gate_id}</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-8"
                      onClick={() => setGateDialog({ type: "gate", villa: v })}>
                      <DoorOpen className="w-3 h-3 mr-1" />Gate
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-8"
                      onClick={() => setGateDialog({ type: "door", villa: v })}>
                      <DoorOpen className="w-3 h-3 mr-1" />Door
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="allowed">Allowed</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={villaFilter} onValueChange={(v) => { setVillaFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All villas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All villas</SelectItem>
              {villas.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{total} events</span>
        </div>

        {/* Events table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !eventsData?.items.length ? (
              <div className="py-16 text-center text-muted-foreground">No events found.</div>
            ) : (
              <div className="divide-y divide-border/50">
                {eventsData.items.map((e) => <EventRow key={e.id} event={e} villaMap={villaMap} />)}
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
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      <Dialog open={!!gateDialog} onOpenChange={(open) => !open && setGateDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Open {gateDialog?.type === "gate" ? "Gate" : "Door"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Open the {gateDialog?.type} for <strong>{gateDialog?.villa.name}</strong>?
            This action will be logged.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGateDialog(null)}>Cancel</Button>
            <Button onClick={() => gateDialog && gateAction.mutate({ type: gateDialog.type, villa_id: gateDialog.villa.id })}
              disabled={gateAction.isPending}>
              {gateAction.isPending ? "Opening..." : "Confirm Open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function EventRow({ event, villaMap }: { event: AccessEvent; villaMap: Record<string, string> }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
      <span className={cn("text-xs px-2 py-1 rounded-full border font-medium shrink-0 w-20 text-center capitalize", statusColors[event.status] ?? "bg-muted text-muted-foreground border-border")}>
        {event.status}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-medium text-foreground">{event.license_plate ?? "—"}</span>
          <span className="text-xs text-muted-foreground capitalize">{event.event_type?.replace("_", " ")}</span>
          {event.villa_id && <span className="text-xs text-muted-foreground">{villaMap[event.villa_id] ?? event.villa_id}</span>}
        </div>
        {event.confidence_score != null && (
          <div className="text-xs text-muted-foreground">
            Confidence: {Math.round(event.confidence_score * 100)}%
          </div>
        )}
      </div>
      <div className="text-right text-xs text-muted-foreground shrink-0">
        <div className="font-medium text-foreground">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
        <div>{new Date(event.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
      </div>
    </div>
  );
}
