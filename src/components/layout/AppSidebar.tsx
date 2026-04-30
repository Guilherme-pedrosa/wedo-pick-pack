import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  PackageCheck,
  ShoppingCart,
  Search,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Package,
  Boxes,
  Wrench,
  BarChart3,
  ClipboardList,
  ClipboardCheck,
  FileText,
  Briefcase,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { logSystemAction } from "@/lib/systemLog";

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  isAdmin: boolean;
  userName: string;
}

interface MenuItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  badge?: number;
  adminOnly?: boolean;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    label: "",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    ],
  },
  {
    label: "Operação",
    items: [
      { title: "Checkout", icon: Package, href: "/checkout" },
      { title: "Separações", icon: PackageCheck, href: "/separations" },
      { title: "Devoluções", icon: Undo2, href: "/devolucoes" },
    ],
  },
  {
    label: "Controle e Saída",
    items: [
      { title: "Caixas", icon: Boxes, href: "/controle/caixas" },
      { title: "Maletas", icon: Briefcase, href: "/controle/maletas" },
      { title: "Técnicos", icon: Wrench, href: "/controle/tecnicos" },
      { title: "Mov. Caixas", icon: ClipboardList, href: "/controle/logs" },
      { title: "Mov. Maletas", icon: ClipboardList, href: "/controle/logs-maletas" },
      { title: "Log Check-ins", icon: ClipboardCheck, href: "/controle/checkins" },
      { title: "Log Baixas", icon: FileText, href: "/controle/baixas" },
      { title: "Log Vinculações", icon: LogOut, href: "/controle/vinculacoes" },
    ],
  },
  {
    label: "Suprimentos",
    items: [
      { title: "Compras", icon: ShoppingCart, href: "/compras" },
      { title: "Análise Estoque", icon: BarChart3, href: "/analise-estoque" },
      { title: "Rastreador", icon: Search, href: "/rastreador" },
      { title: "Log OS Geradas", icon: ClipboardList, href: "/rastreador/logs" },
      { title: "Política Estoque", icon: Settings, href: "/config/estoque" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Configurações", icon: Settings, href: "/config" },
      { title: "Usuários", icon: Users, href: "/admin/users", adminOnly: true },
      { title: "Logs do Sistema", icon: ClipboardList, href: "/admin/logs", adminOnly: true },
    ],
  },
];

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose, isAdmin, userName }: AppSidebarProps) {
  const location = useLocation();

  const handleLogout = async () => {
    await logSystemAction({ module: "auth", action: "Logout realizado" });
    await supabase.auth.signOut();
  };

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        {(!collapsed || mobileOpen) ? (
          <div className="flex items-center gap-2">
            <Package className="h-7 w-7 text-primary" />
            <div className="flex flex-col">
              <span className="text-base font-bold text-sidebar-foreground leading-tight">WeDo</span>
              <span className="text-[10px] font-medium text-sidebar-foreground/60 leading-tight">Pick & Pack</span>
            </div>
          </div>
        ) : (
          <Package className="h-6 w-6 text-primary mx-auto" />
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-3">
          {menuGroups.map((group, groupIndex) => (
            <div key={groupIndex} className={cn(group.label && "mt-5")}>
              {group.label && (!collapsed || mobileOpen) && (
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items
                  .filter((item) => !item.adminOnly || isAdmin)
                  .map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                      <li key={item.href}>
                        <NavLink
                          to={item.href}
                          onClick={() => mobileOpen && onMobileClose?.()}
                          className={cn(
                            "sidebar-item",
                            collapsed && !mobileOpen && "justify-center px-2",
                            isActive && "sidebar-item-active"
                          )}
                          title={collapsed && !mobileOpen ? item.title : undefined}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          {(!collapsed || mobileOpen) && (
                            <span className="flex-1 truncate text-[13px]">{item.title}</span>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-3", collapsed && !mobileOpen && "justify-center")}>
          <Avatar className="h-9 w-9 flex-shrink-0">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          {(!collapsed || mobileOpen) && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{userName}</p>
            </div>
          )}
          {(!collapsed || mobileOpen) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={mobileOpen ? onMobileClose : onToggle}
          className={cn(
            "w-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed && !mobileOpen && "px-2"
          )}
        >
          {mobileOpen ? (
            <>
              <X className="h-4 w-4 mr-2" />
              <span>Fechar</span>
            </>
          ) : collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span className="text-xs">Recolher menu</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden md:flex h-dvh flex-col transition-all duration-200 pt-safe pb-safe pl-safe",
          "bg-[hsl(var(--sidebar-background))]",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (drawer) */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex md:hidden h-dvh w-72 flex-col transition-transform duration-300 shadow-2xl pt-safe pb-safe pl-safe",
          "bg-[hsl(var(--sidebar-background))]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
