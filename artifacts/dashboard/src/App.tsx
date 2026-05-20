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
import LogsPage from "@/pages/logs";
import EventsPage from "@/pages/events";
import MockPage from "@/pages/mock";
import DiagnosticsPage from "@/pages/diagnostics";
import SettingsPage from "@/pages/settings";
import GalleryPage from "@/pages/gallery";
import HealthPage from "@/pages/health";
import TimelinePage from "@/pages/timeline";
import ExportPage from "@/pages/export";
import VillasPage from "@/pages/villas";
import UsersPage from "@/pages/users";
import TempCredentialsPage from "@/pages/temp-credentials";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={() => <PublicRoute component={LoginPage} />} />
      <Route path="/" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/villas" component={() => <ProtectedRoute component={VillasPage} />} />
      <Route path="/reservations" component={() => <ProtectedRoute component={ReservationsPage} />} />
      <Route path="/vehicles" component={() => <ProtectedRoute component={VehiclesPage} />} />
      <Route path="/access" component={() => <ProtectedRoute component={AccessControlPage} />} />
      <Route path="/cameras" component={() => <ProtectedRoute component={CamerasPage} />} />
      <Route path="/entrances" component={() => <ProtectedRoute component={EntrancesPage} />} />
      <Route path="/logs" component={() => <ProtectedRoute component={LogsPage} />} />
      <Route path="/events" component={() => <ProtectedRoute component={EventsPage} />} />
      <Route path="/mock" component={() => <ProtectedRoute component={MockPage} />} />
      <Route path="/diagnostics" component={() => <ProtectedRoute component={DiagnosticsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/gallery" component={() => <ProtectedRoute component={GalleryPage} />} />
      <Route path="/health" component={() => <ProtectedRoute component={HealthPage} />} />
      <Route path="/timeline" component={() => <ProtectedRoute component={TimelinePage} />} />
      <Route path="/export" component={() => <ProtectedRoute component={ExportPage} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
      <Route path="/temp-credentials" component={() => <ProtectedRoute component={TempCredentialsPage} />} />
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
