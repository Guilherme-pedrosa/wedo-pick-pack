import { useState, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppLayoutHeader } from "./AppLayoutHeader";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { logSystemAction } from "@/lib/systemLog";

interface AppLayoutProps {
  isAdmin: boolean;
  userName: string;
}

export function AppLayout({ isAdmin, userName }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();

  useEffect(() => {
    if (isMobile) {
      setCollapsed(true);
      setMobileOpen(false);
    }
  }, [isMobile]);

  // Log page navigation
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      prevPathRef.current = location.pathname;
      const ROUTE_MODULES: Record<string, string> = {
        '/dashboard': 'dashboard',
        '/checkout': 'checkout',
        '/separations': 'separations',
        '/compras': 'compras',
        '/rastreador': 'rastreador',
        '/controle/caixas': 'controle_caixas',
        '/controle/maletas': 'controle_maletas',
        '/controle/tecnicos': 'controle_tecnicos',
        '/controle/logs': 'controle_caixas',
        '/controle/logs-maletas': 'controle_maletas',
        '/config': 'config',
        '/admin/users': 'admin',
        '/admin/logs': 'admin',
        '/rastreador/logs': 'rastreador',
      };
      const module = ROUTE_MODULES[location.pathname] || 'navigation';
      logSystemAction({ module, action: `Acessou ${location.pathname}` });
    }
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh w-full bg-background">
      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <AppSidebar
        collapsed={isMobile ? false : collapsed}
        onToggle={() => (isMobile ? setMobileOpen(!mobileOpen) : setCollapsed(!collapsed))}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isAdmin={isAdmin}
        userName={userName}
      />

      <div
        className={cn(
          "flex min-h-dvh flex-col transition-all duration-200",
          isMobile ? "ml-0" : collapsed ? "ml-16" : "ml-60"
        )}
      >
        <AppLayoutHeader
          onMenuClick={() => setMobileOpen(true)}
          showMenuButton={isMobile}
        />

        <main className="flex-1 p-4 md:p-8 overflow-x-hidden page-enter pl-safe pr-safe pb-safe">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
