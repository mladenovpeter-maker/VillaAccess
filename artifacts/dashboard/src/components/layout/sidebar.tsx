import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Car, ShieldCheck, Camera, ScrollText,
  Activity, LogOut, Menu, X, DoorOpen, FlaskConical,
  Stethoscope, Settings2, HeartPulse, GitCommitHorizontal,
  Download, Users, KeyRound, Phone, Zap, Sparkles,
  Factory, HardHat, Clock, Grid3X3, Building2, CalendarDays, BrainCircuit,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Role = "admin" | "operator" | "viewer";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
};

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const role = (user?.role ?? "viewer") as Role;

  const mainItems: NavItem[] = [
    { href: "/",             label: t("nav.dashboard"),  icon: LayoutDashboard, roles: ["admin", "viewer"] },
    { href: "/controls",     label: t("nav.controls"),   icon: Zap,             roles: ["admin", "operator"] },
    { href: "/vehicles",     label: t("nav.vehicles"),   icon: Car,             roles: ["admin", "operator", "viewer"] },
    { href: "/entrances",    label: t("nav.entrances"),  icon: DoorOpen,        roles: ["admin"] },
    { href: "/cameras",      label: t("nav.cameras"),    icon: Camera,          roles: ["admin"] },
    { href: "/access-control", label: t("nav.intercoms"), icon: KeyRound,       roles: ["admin"] },
    { href: "/events",       label: t("nav.events"),     icon: Activity,        roles: ["admin", "operator", "viewer"] },
  ];

  const adminItems: NavItem[] = [
    { href: "/users",          label: t("nav.users"),        icon: Users,    roles: ["admin"] },
    { href: "/workers",        label: t("nav.workers"),      icon: HardHat,   roles: ["admin", "operator"] },
    { href: "/departments",    label: t("nav.departments"),  icon: Building2,    roles: ["admin"] },
    { href: "/shifts",         label: t("nav.shifts"),       icon: Clock,        roles: ["admin"] },
    { href: "/leaves",         label: t("nav.leaves"),       icon: CalendarDays,  roles: ["admin"] },
    { href: "/ai-attendance",  label: t("nav.aiAttendance"), icon: BrainCircuit,  roles: ["admin"] },
    { href: "/access-matrix",  label: t("nav.accessMatrix"), icon: Grid3X3,  roles: ["admin"] },
  ];

  const toolItems: NavItem[] = [
    { href: "/diagnostics", label: t("nav.diagnostics"), icon: Stethoscope, roles: ["admin"] },
    { href: "/ai-usage",    label: t("nav.aiUsage"),     icon: Sparkles,    roles: ["admin"] },
    { href: "/health",      label: t("nav.health"),      icon: HeartPulse,  roles: ["admin"] },
    { href: "/export",      label: t("nav.export"),      icon: Download,    roles: ["admin"] },
    { href: "/settings",    label: t("nav.settings"),    icon: Settings2,   roles: ["admin"] },
  ];

  function visible(items: NavItem[]) {
    return items.filter((item) => item.roles.includes(role));
  }

  function SectionLabel({ label }: { label: string }) {
    return (
      <div className="pt-3 pb-1">
        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">{label}</p>
      </div>
    );
  }

  function NavLink({ href, label, icon: Icon }: NavItem) {
    const active = href === "/" ? location === "/" : location.startsWith(href);
    return (
      <Link href={href} onClick={() => setOpen(false)}>
        <div className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
          active
            ? "bg-primary/15 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}>
          <Icon className="w-4 h-4 shrink-0" />
          {label}
        </div>
      </Link>
    );
  }

  const visibleAdmin = visible(adminItems);
  const visibleTools = visible(toolItems);

  return (
    <>
      <button
        className="fixed top-4 left-4 z-50 md:hidden bg-card border border-border rounded-lg p-2"
        onClick={() => setOpen(!open)}
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)} />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Factory className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold text-sm text-sidebar-foreground leading-none">MakmetalAccess</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("nav.controlCenter")}</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {visible(mainItems).map((item) => <NavLink key={item.href} {...item} />)}

          {visibleAdmin.length > 0 && (
            <>
              <SectionLabel label={t("nav.administration")} />
              {visibleAdmin.map((item) => <NavLink key={item.href} {...item} />)}
            </>
          )}

          {visibleTools.length > 0 && (
            <>
              <SectionLabel label={t("nav.tools")} />
              {visibleTools.map((item) => <NavLink key={item.href} {...item} />)}
            </>
          )}
        </nav>

        <LanguageSwitcher />

        {/* User */}
        <div className="border-t border-sidebar-border px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              {user?.full_name?.charAt(0) ?? user?.username?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sidebar-foreground truncate">
                {user?.full_name ?? user?.username}
              </div>
              <div className="text-xs text-muted-foreground capitalize">{user?.role}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={() => void logout()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t("nav.signOut")}
          </Button>
        </div>
      </aside>
    </>
  );
}
