import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCheckoutStore } from "@/store/checkoutStore";
import { lazy, Suspense, useEffect, useState } from "react";
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const BoxesPage = lazy(() => import("./pages/controle/BoxesPage"));
const ToolboxesPage = lazy(() => import("./pages/controle/ToolboxesPage"));
const TechniciansPage = lazy(() => import("./pages/controle/TechniciansPage"));
const HandoffLogsPage = lazy(() => import("./pages/controle/HandoffLogsPage"));
const ToolboxLogsPage = lazy(() => import("./pages/controle/ToolboxLogsPage"));
const CheckinLogsPage = lazy(() => import("./pages/controle/CheckinLogsPage"));
const BaixaLogsPage = lazy(() => import("./pages/controle/BaixaLogsPage"));
const HandoffHistoryPage = lazy(() => import("./pages/controle/HandoffHistoryPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const PartialWriteoffPage = lazy(() => import("./pages/PartialWriteoffPage"));
const ConfigPage = lazy(() => import("./pages/ConfigPage"));
const InventoryPolicyPage = lazy(() => import("./pages/InventoryPolicyPage"));
const InventoryAnalysisPage = lazy(() => import("./pages/InventoryAnalysisPage"));
const ComprasPage = lazy(() => import("./pages/ComprasPage"));
const PurchaseTrackerPage = lazy(() => import("./pages/PurchaseTrackerPage"));
const RelatorioPedidosPage = lazy(() => import("./pages/RelatorioPedidosPage"));
const RastreadorPage = lazy(() => import("./pages/RastreadorPage"));
const OrcamentoAnalysisPage = lazy(() => import("./pages/OrcamentoAnalysisPage"));
const EtiquetasPage = lazy(() => import("@/pages/EtiquetasPage"));
const ProductExplorerPage = lazy(() => import("./pages/ProductExplorerPage"));
const EstoqueIAPage = lazy(() => import("./pages/EstoqueIAPage"));
const ProductExplorerConfigPage = lazy(() => import("./pages/ProductExplorerConfigPage"));
const OSGenerationLogsPage = lazy(() => import("./pages/OSGenerationLogsPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const SeparationsPage = lazy(() => import("./pages/SeparationsPage"));
const ProductDetailPage = lazy(() => import("./pages/ProductDetailPage"));

const ReturnLogsPage = lazy(() => import("./pages/ReturnLogsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SystemLogsPage = lazy(() => import("./pages/SystemLogsPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { user, profile, isAdmin, loading } = useAuth();
  const setConfig = useCheckoutStore(s => s.setConfig);
  const operatorUserId = useCheckoutStore(s => s.config.operatorUserId);
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
    if (user) {
      setConfig({
        operatorUserId: user?.id || '',
        operatorName: profile?.name || user.email || '',
        gcUsuarioId: profile?.gc_usuario_id || '',
        osStatusToShow: profile?.os_status_to_show ?? [],
        vendaStatusToShow: profile?.venda_status_to_show ?? [],
        defaultOSConclusionStatus: profile?.default_os_conclusion_status ?? '',
        defaultVendaConclusionStatus: profile?.default_venda_conclusion_status ?? '',
      });
    }
  }, [
    user?.id,
    user?.email,
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
  if (operatorUserId !== user.id) return <div role="status" className="p-6">Carregando seu perfil e sua conferência…</div>;

  return (
    <Routes>
      <Route element={<AppLayout isAdmin={isAdmin} userName={profile?.name || user.email || ''} />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/baixa-parcial" element={<PartialWriteoffPage />} />
        <Route path="/separations" element={<SeparationsPage />} />
        <Route path="/agendamento" element={<SeparationsPage defaultTab="agenda" />} />
        
        <Route path="/devolucoes" element={<ReturnLogsPage />} />
        <Route path="/compras" element={<ComprasPage />} />
        <Route path="/compras/acompanhamento" element={<PurchaseTrackerPage />} />
        <Route path="/compras/relatorio-fornecedor" element={<RelatorioPedidosPage />} />
        <Route path="/controle/caixas" element={<BoxesPage />} />
        <Route path="/controle/maletas" element={<ToolboxesPage />} />
        <Route path="/controle/tecnicos" element={<TechniciansPage />} />
        <Route path="/controle/logs" element={<HandoffLogsPage />} />
        <Route path="/controle/logs-maletas" element={<ToolboxLogsPage />} />
        <Route path="/controle/checkins" element={<CheckinLogsPage />} />
        <Route path="/controle/baixas" element={<BaixaLogsPage />} />
        <Route path="/controle/vinculacoes" element={<HandoffHistoryPage />} />
        <Route path="/rastreador" element={<RastreadorPage />} />
        <Route path="/analise-orcamento" element={<OrcamentoAnalysisPage />} />
        <Route path="/rastreador/logs" element={<OSGenerationLogsPage />} />
        <Route path="/etiquetas" element={<EtiquetasPage />} />
        <Route path="/produtos/explorar" element={<ProductExplorerPage />} />
        <Route path="/produtos/explorar/config" element={<ProductExplorerConfigPage />} />
        <Route path="/produtos/:productId" element={<ProductDetailPage />} />
        <Route path="/estoque-ia" element={<EstoqueIAPage />} />
        <Route path="/estoque-ia/:threadId" element={<EstoqueIAPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/config/estoque" element={<InventoryPolicyPage />} />
        <Route path="/analise-estoque" element={<InventoryAnalysisPage />} />
        <Route
          path="/admin/users"
          element={isAdmin ? <AdminUsersPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/admin/logs"
          element={isAdmin ? <SystemLogsPage /> : <Navigate to="/dashboard" replace />}
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
        <RouteErrorBoundary>
          <Suspense fallback={<div role="status" className="min-h-screen flex items-center justify-center gap-2"><Loader2 className="h-6 w-6 animate-spin" />Carregando tela…</div>}>
            <AuthenticatedApp />
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
