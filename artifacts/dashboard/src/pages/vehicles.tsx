import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vehiclesApi, type Vehicle } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Car, Clock, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  known: "bg-green-500/15 text-green-400 border-green-500/20",
  unknown: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  blacklisted: "bg-red-500/15 text-red-400 border-red-500/20",
};

const VEHICLE_TYPES = ["sedan", "suv", "van", "truck", "motorcycle", "other"];

interface VehicleForm {
  license_plate: string;
  make: string;
  model: string;
  color: string;
  vehicle_type: string;
  status: string;
  notes: string;
}

const defaultForm: VehicleForm = {
  license_plate: "", make: "", model: "", color: "",
  vehicle_type: "sedan", status: "unknown", notes: "",
};

export default function VehiclesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<VehicleForm>(defaultForm);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles", statusFilter],
    queryFn: () => vehiclesApi.list(statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  const { data: vehicleEvents } = useQuery({
    queryKey: ["vehicle-events", selectedVehicle?.id],
    queryFn: () => vehiclesApi.events(selectedVehicle!.id),
    enabled: !!selectedVehicle,
  });

  const createMut = useMutation({
    mutationFn: (data: VehicleForm) => vehiclesApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); setDialogOpen(false); toast({ title: "Vehicle added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: VehicleForm }) => vehiclesApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); setDialogOpen(false); toast({ title: "Vehicle updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => vehiclesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); toast({ title: "Vehicle deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = vehicles.filter((v) =>
    !search || v.license_plate.toLowerCase().includes(search.toLowerCase()) ||
    (v.make ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (v.model ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openNew() { setEditTarget(null); setForm(defaultForm); setDialogOpen(true); }
  function openEdit(v: Vehicle) {
    setEditTarget(v);
    setForm({ license_plate: v.license_plate, make: v.make ?? "", model: v.model ?? "", color: v.color ?? "",
      vehicle_type: v.vehicle_type ?? "sedan", status: v.status, notes: v.notes ?? "" });
    setDialogOpen(true);
  }
  function handleSubmit() {
    if (editTarget) updateMut.mutate({ id: editTarget.id, data: form });
    else createMut.mutate(form);
  }

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <AppLayout
      title="Vehicles"
      subtitle="Registered and detected vehicles"
      actions={<Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Vehicle</Button>}
    >
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search plate, make, model..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2">
            {["all", "known", "unknown", "blacklisted"].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize",
                  statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30")}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Counts */}
        <div className="text-sm text-muted-foreground">{filtered.length} vehicle{filtered.length !== 1 ? "s" : ""}</div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">No vehicles found.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((v) => (
              <Card key={v.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-bold text-base text-foreground font-mono">{v.license_plate}</div>
                      <div className="text-sm text-muted-foreground">{[v.make, v.model].filter(Boolean).join(" ") || "Unknown vehicle"}</div>
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", statusColors[v.status] ?? "")}>
                      {v.status}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {v.color && <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block bg-primary/30" />{v.color} · {v.vehicle_type}</div>}
                    <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />{v.total_visits} visits{v.confidence_score != null ? ` · ${Math.round(v.confidence_score * 100)}% conf.` : ""}</div>
                    {v.last_seen && <div>Last seen: {new Date(v.last_seen).toLocaleDateString()}</div>}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedVehicle(v)}>
                      <Eye className="w-3 h-3 mr-1" />Events
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive ml-auto" onClick={() => deleteMut.mutate(v.id)} disabled={deleteMut.isPending}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editTarget ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <FormField label="License Plate *">
                <Input value={form.license_plate} onChange={(e) => setForm({ ...form, license_plate: e.target.value })} placeholder="B 1234 ABC" className="font-mono uppercase" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Make"><Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Toyota" /></FormField>
                <FormField label="Model"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Fortuner" /></FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Color"><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="Silver" /></FormField>
                <FormField label="Type">
                  <Select value={form.vehicle_type} onValueChange={(v) => setForm({ ...form, vehicle_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{VEHICLE_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
              </div>
              <FormField label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="known">Known</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="blacklisted">Blacklisted</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></FormField>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={loading || !form.license_plate}>{loading ? "Saving..." : editTarget ? "Update" : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Events dialog */}
        <Dialog open={!!selectedVehicle} onOpenChange={(open) => !open && setSelectedVehicle(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Events — {selectedVehicle?.license_plate}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {!vehicleEvents ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : vehicleEvents.items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No events recorded.</p>
              ) : vehicleEvents.items.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium capitalize">{e.event_type?.replace("_", " ")}</div>
                    <div className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
                  </div>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", {
                    "bg-green-500/15 text-green-400 border-green-500/20": e.status === "allowed",
                    "bg-red-500/15 text-red-400 border-red-500/20": e.status === "denied",
                    "bg-blue-500/15 text-blue-400 border-blue-500/20": e.status === "manual",
                  })}>{e.status}</span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}
