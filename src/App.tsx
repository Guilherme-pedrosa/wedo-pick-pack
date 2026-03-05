import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCheckoutStore } from "@/store/checkoutStore";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/layout/AppHeader";
import CheckoutPage from "./pages/CheckoutPage";
import ConfigPage from "./pages/ConfigPage";
import ComprasPage from "./pages/ComprasPage";
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

    // Check if setup is needed (no admins)
    supabase.rpc('has_any_admin').then(({ data }) => {
      setNeedsSetup(data === false);
    });
  }, [loading, user]);

  // Sync operator info from profile
  useEffect(() => {
    if (profile) {
      setConfig({ operatorName: profile.name, gcUsuarioId: profile.gc_usuario_id || '' });
    }
  }, [profile?.name, profile?.gc_usuario_id, setConfig]);

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
    <>
      <AppHeader isAdmin={isAdmin} userName={profile?.name || user.email || ''} />
      <Routes>
        <Route path="/" element={<Navigate to="/checkout" replace />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/separations" element={<SeparationsPage />} />
        <Route path="/compras" element={<ComprasPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route
          path="/admin/users"
          element={isAdmin ? <AdminUsersPage /> : <Navigate to="/checkout" replace />}
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
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
