import { Link, useLocation } from 'react-router-dom';
import { Settings, Package, LogOut, Users, PackageCheck, ShoppingCart, Search } from 'lucide-react';
import { isUsingMock } from '@/api/gestaoclick';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface Props {
  isAdmin: boolean;
  userName: string;
}

export default function AppHeader({ isAdmin, userName }: Props) {
  const location = useLocation();
  const mock = isUsingMock();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

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

          <nav className="flex items-center gap-1">
            <Link
              to="/checkout"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location.pathname === '/checkout' || location.pathname === '/'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              Checkout
            </Link>
            <Link
              to="/separations"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                location.pathname === '/separations'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              <PackageCheck className="h-3.5 w-3.5" />
              Separações
            </Link>
            <Link
              to="/compras"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                location.pathname === '/compras'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              Compras
            </Link>
            <Link
              to="/rastreador"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                location.pathname === '/rastreador'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              Rastreador
            </Link>
            <Link
              to="/config"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                location.pathname === '/config'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              Config
            </Link>
            {isAdmin && (
              <Link
                to="/admin/users"
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/admin/users'
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Usuários
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${mock ? 'bg-red-400' : 'bg-green-400'}`} />
            <span className="text-blue-200 hidden sm:inline">{mock ? 'Demo' : 'GC'}</span>
            <span className="text-blue-100 font-medium">{userName}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-200 hover:text-primary-foreground hover:bg-secondary/50 h-7 px-2"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>
    </>
  );
}
