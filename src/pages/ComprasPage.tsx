import { useState } from 'react';
import OrcamentosPanel from '@/components/compras/OrcamentosPanel';
import ComprasResultPanel from '@/components/compras/ComprasResultPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { FileText } from 'lucide-react';

export default function ComprasPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-background">
      {/* Desktop left panel */}
      <div className="hidden md:flex w-[360px] border-r border-border bg-card flex-col shrink-0">
        <OrcamentosPanel />
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ComprasResultPanel />
      </div>

      {/* Mobile drawer */}
      <div className="md:hidden">
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
      </div>
    </div>
  );
}
