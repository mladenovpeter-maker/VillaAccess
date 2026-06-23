import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  CalendarDays, Car, KeyRound, Lock, Camera, LayoutDashboard, Zap, Building2,
  DoorOpen, Activity, Users, Settings2, Stethoscope, Sparkles, HeartPulse, Download,
} from "lucide-react";

type Role = "admin" | "operator";

interface PageDef {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  roles: Role[];
}

const PAGES: PageDef[] = [
  { href: "/",                labelKey: "nav.dashboard",       icon: LayoutDashboard, roles: ["admin"] },
  { href: "/controls",        labelKey: "nav.controls",        icon: Zap,             roles: ["admin", "operator"] },
  { href: "/reservations",    labelKey: "nav.reservations",    icon: CalendarDays,    roles: ["admin", "operator"] },
  { href: "/vehicles",        labelKey: "nav.vehicles",        icon: Car,             roles: ["admin", "operator"] },
  { href: "/villas",          labelKey: "nav.villas",          icon: Building2,       roles: ["admin"] },
  { href: "/cameras",         labelKey: "nav.cameras",         icon: Camera,          roles: ["admin"] },
  { href: "/access-control",  labelKey: "nav.intercoms",       icon: KeyRound,        roles: ["admin"] },
  { href: "/locks",           labelKey: "nav.locks",           icon: Lock,            roles: ["admin"] },
  { href: "/entrances",       labelKey: "nav.entrances",       icon: DoorOpen,        roles: ["admin"] },
  { href: "/events",          labelKey: "nav.events",          icon: Activity,        roles: ["admin", "operator"] },
  { href: "/temp-credentials",labelKey: "nav.tempCredentials", icon: KeyRound,        roles: ["admin", "operator"] },
  { href: "/users",           labelKey: "nav.users",           icon: Users,           roles: ["admin"] },
  { href: "/diagnostics",     labelKey: "nav.diagnostics",     icon: Stethoscope,     roles: ["admin"] },
  { href: "/ai-usage",        labelKey: "nav.aiUsage",         icon: Sparkles,        roles: ["admin"] },
  { href: "/health",          labelKey: "nav.health",          icon: HeartPulse,      roles: ["admin"] },
  { href: "/export",          labelKey: "nav.export",          icon: Download,        roles: ["admin"] },
  { href: "/settings",        labelKey: "nav.settings",        icon: Settings2,       roles: ["admin"] },
];

const CAP = 25;

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user?.role as Role | undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isAdmin = role === "admin";
  const isOpOrAbove = role === "admin" || role === "operator";

  const { data } = useQuery({
    queryKey: ["global-search", role],
    enabled: open && Boolean(role),
    staleTime: 30_000,
    queryFn: async () => {
      const safe = <T,>(p: Promise<T>): Promise<T | []> => p.catch(() => [] as unknown as []);
      const [reservations, vehicles, intercoms, locks, cameras, temp] = await Promise.all([
        safe(api.get<any[]>("/reservations")),
        safe(api.get<any[]>("/vehicles")),
        isAdmin ? safe(api.get<any[]>("/intercoms")) : Promise.resolve([]),
        isAdmin ? safe(api.get<any[]>("/locks")) : Promise.resolve([]),
        isAdmin ? safe(api.get<any[]>("/cameras")) : Promise.resolve([]),
        isOpOrAbove ? safe(api.get<any[]>("/temp-credentials")) : Promise.resolve([]),
      ]);
      return { reservations, vehicles, intercoms, locks, cameras, temp };
    },
  });

  const go = (path: string) => {
    setOpen(false);
    setLocation(path);
  };

  const pages = PAGES.filter((p) => (role ? p.roles.includes(role) : false));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("search.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("search.empty")}</CommandEmpty>

        <CommandGroup heading={t("search.pages")}>
          {pages.map((p) => {
            const Icon = p.icon;
            const label = t(p.labelKey);
            return (
              <CommandItem key={p.href} value={`page ${label} ${p.href}`} onSelect={() => go(p.href)}>
                <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                {label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {data?.reservations?.length ? (
          <CommandGroup heading={t("search.reservations")}>
            {data.reservations.slice(0, CAP).map((r: any) => (
              <CommandItem
                key={r.id}
                value={`reservation ${r.guest_name ?? ""} ${r.villa?.name ?? ""} ${r.pin_code ?? ""}`}
                onSelect={() => go("/reservations")}
              >
                <CalendarDays className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="truncate">{r.guest_name}</span>
                {r.villa?.name && <span className="ml-2 text-xs text-muted-foreground truncate">{r.villa.name}</span>}
                {r.pin_code && <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground">{r.pin_code}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {data?.vehicles?.length ? (
          <CommandGroup heading={t("search.vehicles")}>
            {data.vehicles.slice(0, CAP).map((v: any) => (
              <CommandItem
                key={v.id}
                value={`vehicle ${v.license_plate ?? ""} ${v.make ?? ""} ${v.model ?? ""}`}
                onSelect={() => go("/vehicles")}
              >
                <Car className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="font-mono">{v.license_plate}</span>
                {(v.make || v.model) && (
                  <span className="ml-2 text-xs text-muted-foreground truncate">{[v.make, v.model].filter(Boolean).join(" ")}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {data?.temp?.length ? (
          <CommandGroup heading={t("search.tempCreds")}>
            {data.temp.slice(0, CAP).map((c: any) => (
              <CommandItem
                key={c.id}
                value={`temp ${c.label ?? c.name ?? c.owner_name ?? ""} ${c.pin_code ?? c.pin ?? ""}`}
                onSelect={() => go("/temp-credentials")}
              >
                <KeyRound className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="truncate">{c.label ?? c.name ?? c.owner_name ?? c.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {data?.intercoms?.length ? (
          <CommandGroup heading={t("search.intercoms")}>
            {data.intercoms.slice(0, CAP).map((d: any) => (
              <CommandItem key={d.id} value={`intercom ${d.name ?? ""} ${d.ip_address ?? ""}`} onSelect={() => go("/access-control")}>
                <KeyRound className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="truncate">{d.name}</span>
                {d.ip_address && <span className="ml-2 text-xs text-muted-foreground">{d.ip_address}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {data?.locks?.length ? (
          <CommandGroup heading={t("search.locks")}>
            {data.locks.slice(0, CAP).map((d: any) => (
              <CommandItem key={d.id} value={`lock ${d.name ?? ""}`} onSelect={() => go("/locks")}>
                <Lock className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="truncate">{d.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {data?.cameras?.length ? (
          <CommandGroup heading={t("search.cameras")}>
            {data.cameras.slice(0, CAP).map((d: any) => (
              <CommandItem key={d.id} value={`camera ${d.name ?? ""} ${d.ip_address ?? ""}`} onSelect={() => go("/cameras")}>
                <Camera className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="truncate">{d.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
