import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppLayoutHeader } from "./AppLayoutHeader";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen w-full bg-background">
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
          "flex min-h-screen flex-col transition-all duration-200",
          isMobile ? "ml-0" : collapsed ? "ml-16" : "ml-60"
        )}
      >
        <AppLayoutHeader
          onMenuClick={() => setMobileOpen(true)}
          showMenuButton={isMobile}
        />

        <main className="flex-1 p-4 md:p-8 overflow-x-hidden page-enter">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
        </main>
      </div>
    </div>
  );
}
