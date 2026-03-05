import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useCheckoutStore } from "@/store/checkoutStore";
import AppHeader from "@/components/layout/AppHeader";
import CheckoutPage from "./pages/CheckoutPage";
import ConfigPage from "./pages/ConfigPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useCheckoutStore(s => s.auth.isLoggedIn);
  if (!isLoggedIn) return <LoginPage />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/checkout" replace />} />
          <Route
            path="/checkout"
            element={
              <AuthGuard>
                <AppHeader />
                <CheckoutPage />
              </AuthGuard>
            }
          />
          <Route
            path="/config"
            element={
              <AuthGuard>
                <AppHeader />
                <ConfigPage />
              </AuthGuard>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
