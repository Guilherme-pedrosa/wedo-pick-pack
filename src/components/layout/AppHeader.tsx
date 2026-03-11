import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings, Package, LogOut, Users, PackageCheck, ShoppingCart, Search, Menu, X } from 'lucide-react';
import { isUsingMock } from '@/api/gestaoclick';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

interface Props {
  isAdmin: boolean;
  userName: string;
}

const navItems = [
  { path: '/checkout', label: 'Checkout', icon: null, matchPaths: ['/checkout', '/'] },
  { path: '/separations', label: 'Separações', icon: PackageCheck },
  { path: '/compras', label: 'Compras', icon: ShoppingCart },
  { path: '/rastreador', label: 'Rastreador', icon: Search },
  { path: '/config', label: 'Config', icon: Settings },
];

export default function AppHeader({ isAdmin, userName }: Props) {
  const location = useLocation();
  const mock = isUsingMock();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const isActive = (item: typeof navItems[0]) => {
    if (item.matchPaths) return item.matchPaths.includes(location.pathname);
    return location.pathname === item.path;
  };

  const NavLinks = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {navItems.map(item => (
        <Link
          key={item.path}
          to={item.path}
          onClick={() => mobile && setMenuOpen(false)}
          className={`${mobile ? 'flex items-center gap-3 px-4 py-3 text-base' : 'px-4 py-1.5 rounded-md text-sm'} font-medium transition-colors ${mobile ? 'flex items-center gap-3' : 'flex items-center gap-1.5'} ${
            isActive(item)
              ? mobile ? 'bg-secondary text-secondary-foreground rounded-md' : 'bg-secondary text-secondary-foreground'
              : mobile ? 'text-foreground hover:bg-muted rounded-md' : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
          }`}
        >
          {item.icon && <item.icon className={mobile ? 'h-5 w-5' : 'h-3.5 w-3.5'} />}
          {item.label}
        </Link>
      ))}
      {isAdmin && (
        <Link
          to="/admin/users"
          onClick={() => mobile && setMenuOpen(false)}
          className={`${mobile ? 'flex items-center gap-3 px-4 py-3 text-base' : 'px-4 py-1.5 rounded-md text-sm'} font-medium transition-colors flex items-center gap-${mobile ? '3' : '1.5'} ${
            location.pathname === '/admin/users'
              ? mobile ? 'bg-secondary text-secondary-foreground rounded-md' : 'bg-secondary text-secondary-foreground'
              : mobile ? 'text-foreground hover:bg-muted rounded-md' : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
          }`}
        >
          <Users className={mobile ? 'h-5 w-5' : 'h-3.5 w-3.5'} />
          Usuários
        </Link>
      )}
    </>
  );

  return (
    <>
      {mock && (
        <div className="bg-amber-400 text-amber-900 text-center text-sm py-1.5 font-medium px-4">
          ⚠️ Modo demonstração — dados fictícios. Configure suas credenciais em{' '}
          <Link to="/config" className="underline font-bold">Configurações</Link>.
        </div>
      )}
      <header className="bg-primary text-primary-foreground sticky top-0 z-50 shadow-md">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Package className="h-6 w-6" />
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold tracking-tight">WeDo</span>
              <span className="text-sm text-blue-200 font-medium">Checkout</span>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLinks />
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${mock ? 'bg-red-400' : 'bg-green-400'}`} />
            <span className="text-blue-200 hidden sm:inline">{mock ? 'Demo' : 'GC'}</span>
            <span className="text-blue-100 font-medium hidden sm:inline">{userName}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-200 hover:text-primary-foreground hover:bg-secondary/50 h-7 px-2 hidden md:inline-flex"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>

            {/* Mobile hamburger */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden text-primary-foreground hover:bg-secondary/50 h-9 w-9"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] p-0">
                <div className="flex flex-col h-full">
                  <div className="p-4 border-b border-border">
                    <p className="font-semibold text-foreground">{userName}</p>
                    <p className="text-sm text-muted-foreground">{mock ? 'Modo Demo' : 'GestãoClick'}</p>
                  </div>
                  <nav className="flex-1 p-3 space-y-1">
                    <NavLinks mobile />
                  </nav>
                  <div className="p-4 border-t border-border">
                    <Button variant="outline" className="w-full gap-2" onClick={handleLogout}>
                      <LogOut className="h-4 w-4" /> Sair
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  );
}
