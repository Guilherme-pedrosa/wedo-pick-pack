import { useState } from 'react';
import OrderQueue from '@/components/checkout/OrderQueue';
import ConferencePanel from '@/components/checkout/ConferencePanel';
import { useCheckoutStore } from '@/store/checkoutStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ClipboardList } from 'lucide-react';

export default function CheckoutPage() {
  const session = useCheckoutStore(s => s.session);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // On mobile, show OrderQueue full-screen when no session, otherwise show ConferencePanel
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen-mobile bg-background">
        {!session ? (
          <OrderQueue />
        ) : (
          <>
            <ConferencePanel />
            {/* Floating button to access queue while in session */}
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  className="fixed bottom-4 left-4 z-50 rounded-full h-12 w-12 shadow-lg"
                >
                  <ClipboardList className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-[320px]">
                <OrderQueue />
              </SheetContent>
            </Sheet>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-background">
      {/* Desktop left panel */}
      <div className="flex w-[360px] border-r border-border bg-card flex-col shrink-0">
        <OrderQueue />
      </div>
      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ConferencePanel />
      </div>
    </div>
  );
}
