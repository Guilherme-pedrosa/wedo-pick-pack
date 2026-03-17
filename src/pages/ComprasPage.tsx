import { useState } from 'react';
import OrcamentosPanel from '@/components/compras/OrcamentosPanel';
import ComprasResultPanel from '@/components/compras/ComprasResultPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { FileText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

export default function ComprasPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const isMobile = useIsMobile();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-background">
      {/* Desktop left panel */}
      {!isMobile && (
        <div
          className={cn(
            "border-r border-border bg-card flex-col shrink-0 transition-all duration-200 overflow-hidden",
            sidebarVisible ? "w-[360px]" : "w-0 border-r-0"
          )}
        >
          <OrcamentosPanel />
        </div>
      )}

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toggle button for desktop */}
        {!isMobile && (
          <div className="flex items-center px-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarVisible(!sidebarVisible)}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              {sidebarVisible ? (
                <><PanelLeftClose className="h-4 w-4" /> Esconder filtros</>
              ) : (
                <><PanelLeftOpen className="h-4 w-4" /> Mostrar filtros</>
              )}
            </Button>
          </div>
        )}
        <ComprasResultPanel />
      </div>

      {/* Mobile drawer */}
      {isMobile && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-4 left-4 z-50 rounded-full h-12 w-12 shadow-lg"
            >
              <FileText className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[340px]">
            <OrcamentosPanel />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
