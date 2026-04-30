import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "react-router-dom";
import { PushToggle } from "@/components/push/PushToggle";

interface AppLayoutHeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

const pageMeta: Record<string, { title: string; breadcrumb: string[] }> = {
  "/dashboard": { title: "Dashboard", breadcrumb: [] },
  "/checkout": { title: "Checkout", breadcrumb: ["Operação", "Checkout"] },
  "/controle/caixas": { title: "Caixas", breadcrumb: ["Controle e Saída", "Caixas"] },
  "/separations": { title: "Separações", breadcrumb: ["Operação", "Separações"] },
  "/compras": { title: "Compras", breadcrumb: ["Suprimentos", "Compras"] },
  "/rastreador": { title: "Rastreador", breadcrumb: ["Suprimentos", "Rastreador"] },
  "/config": { title: "Configurações", breadcrumb: ["Sistema", "Configurações"] },
  "/admin/users": { title: "Usuários", breadcrumb: ["Sistema", "Usuários"] },
};

export function AppLayoutHeader({ onMenuClick, showMenuButton }: AppLayoutHeaderProps) {
  const location = useLocation();
  const currentPage = pageMeta[location.pathname] || { title: "Página", breadcrumb: [] };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-card px-4 md:px-8">
      <div className="flex items-center gap-4 min-w-0">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="h-9 w-9 flex-shrink-0 -ml-2"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">{currentPage.title}</h1>
          {currentPage.breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {currentPage.breadcrumb.map((item, index) => (
                <span key={index} className="flex items-center gap-1">
                  {index > 0 && <span>›</span>}
                  <span className={index === currentPage.breadcrumb.length - 1 ? "text-foreground font-medium" : ""}>
                    {item}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <PushToggle variant="compact" />
      </div>
    </header>
  );
}
