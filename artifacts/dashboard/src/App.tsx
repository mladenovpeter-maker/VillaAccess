import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import ReservationsPage from "@/pages/reservations";
import VehiclesPage from "@/pages/vehicles";
import AccessControlPage from "@/pages/access";
import CamerasPage from "@/pages/cameras";
import EntrancesPage from "@/pages/entrances";
import IntercomsPage from "@/pages/intercoms";
import LogsPage from "@/pages/logs";
import EventsPage from "@/pages/events";
import MockPage from "@/pages/mock";
import DiagnosticsPage from "@/pages/diagnostics";
import SettingsPage from "@/pages/settings";
import HealthPage from "@/pages/health";
import TimelinePage from "@/pages/timeline";
import ExportPage from "@/pages/export";
import VillasPage from "@/pages/villas";
import UsersPage from "@/pages/users";
import TempCredentialsPage from "@/pages/temp-credentials";

type Role = "admin" | "operator" | "viewer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

function ProtectedRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles?: Role[];
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Redirect to="/login" />;
  if (roles && !roles.includes(user.role as Role)) return <Redirect to="/" />;
  return <Component />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  const adminOnly: Role[]  = ["admin"];
  const opOrAbove: Role[]  = ["admin", "operator"];

  return (
    <Switch>
      <Route path="/login" component={() => <PublicRoute component={LoginPage} />} />

      {/* All authenticated users (incl. operator + viewer) — pure view surfaces */}
      <Route path="/"         component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/timeline" component={() => <ProtectedRoute component={TimelinePage} />} />
      <Route path="/events"   component={() => <ProtectedRoute component={EventsPage} />} />

      {/* Operator and above — operational work surfaces */}
      <Route path="/reservations"  component={() => <ProtectedRoute component={ReservationsPage} />} />
      <Route path="/vehicles"      component={() => <ProtectedRoute component={VehiclesPage}     />} />

      {/* Admin only — infrastructure / system / management surfaces */}
      <Route path="/villas"           component={() => <ProtectedRoute component={VillasPage}           roles={adminOnly} />} />
      <Route path="/access"           component={() => <ProtectedRoute component={AccessControlPage}    roles={adminOnly} />} />
      <Route path="/logs"             component={() => <ProtectedRoute component={LogsPage}             roles={adminOnly} />} />
      <Route path="/entrances"        component={() => <ProtectedRoute component={EntrancesPage}        roles={adminOnly} />} />
      <Route path="/cameras"          component={() => <ProtectedRoute component={CamerasPage}          roles={adminOnly} />} />
      <Route path="/access-control"   component={() => <ProtectedRoute component={IntercomsPage}        roles={adminOnly} />} />
      <Route path="/diagnostics"      component={() => <ProtectedRoute component={DiagnosticsPage}      roles={adminOnly} />} />
      <Route path="/health"           component={() => <ProtectedRoute component={HealthPage}           roles={adminOnly} />} />
      <Route path="/export"           component={() => <ProtectedRoute component={ExportPage}           roles={adminOnly} />} />
      <Route path="/settings"         component={() => <ProtectedRoute component={SettingsPage}         roles={adminOnly} />} />
      <Route path="/users"            component={() => <ProtectedRoute component={UsersPage}            roles={adminOnly} />} />
      <Route path="/temp-credentials" component={() => <ProtectedRoute component={TempCredentialsPage} roles={adminOnly} />} />
      <Route path="/mock"             component={() => <ProtectedRoute component={MockPage}             roles={adminOnly} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
