import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCheckoutStore } from "@/store/checkoutStore";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import BoxesPage from "./pages/controle/BoxesPage";
import ToolboxesPage from "./pages/controle/ToolboxesPage";
import TechniciansPage from "./pages/controle/TechniciansPage";
import HandoffLogsPage from "./pages/controle/HandoffLogsPage";
import CheckoutPage from "./pages/CheckoutPage";
import ConfigPage from "./pages/ConfigPage";
import ComprasPage from "./pages/ComprasPage";
import RastreadorPage from "./pages/RastreadorPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import SeparationsPage from "./pages/SeparationsPage";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { user, profile, isAdmin, loading } = useAuth();
  const setConfig = useCheckoutStore(s => s.setConfig);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  // Check if any admin exists
  useEffect(() => {
    if (loading) return;
    if (user) {
      setNeedsSetup(false);
      return;
    }

    supabase.rpc('has_any_admin').then(({ data, error }) => {
      if (error) {
        console.error('Error checking admin status:', error);
        setNeedsSetup(false);
        return;
      }
      setNeedsSetup(data === false);
    });
  }, [loading, user]);

  // Sync checkout config from user profile
  useEffect(() => {
    if (profile) {
      setConfig({
        operatorName: profile.name,
        gcUsuarioId: profile.gc_usuario_id || '',
        osStatusToShow: profile.os_status_to_show ?? [],
        vendaStatusToShow: profile.venda_status_to_show ?? [],
        defaultOSConclusionStatus: profile.default_os_conclusion_status ?? '',
        defaultVendaConclusionStatus: profile.default_venda_conclusion_status ?? '',
      });
    }
  }, [
    profile?.name,
    profile?.gc_usuario_id,
    profile?.os_status_to_show,
    profile?.venda_status_to_show,
    profile?.default_os_conclusion_status,
    profile?.default_venda_conclusion_status,
    setConfig,
  ]);

  if (loading || needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (needsSetup) {
    return <SetupPage onComplete={() => setNeedsSetup(false)} />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout isAdmin={isAdmin} userName={profile?.name || user.email || ''} />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/separations" element={<SeparationsPage />} />
        <Route path="/compras" element={<ComprasPage />} />
        <Route path="/controle/caixas" element={<BoxesPage />} />
        <Route path="/controle/tecnicos" element={<TechniciansPage />} />
        <Route path="/controle/logs" element={<HandoffLogsPage />} />
        <Route path="/rastreador" element={<RastreadorPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route
          path="/admin/users"
          element={isAdmin ? <AdminUsersPage /> : <Navigate to="/dashboard" replace />}
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthenticatedApp />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
