import { Link, useLocation } from 'react-router-dom';
import { Settings, Package } from 'lucide-react';
import { isUsingMock } from '@/api/gestaoclick';

export default function AppHeader() {
  const location = useLocation();
  const mock = isUsingMock();

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
              to="/config"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                location.pathname === '/config'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-blue-200 hover:text-primary-foreground hover:bg-secondary/50'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              Configurações
            </Link>
          </nav>

          <div className="flex items-center gap-2 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${mock ? 'bg-red-400' : 'bg-green-400'}`} />
            <span className="text-blue-200">{mock ? 'Modo Demo' : 'GC Conectado'}</span>
          </div>
        </div>
      </header>
    </>
  );
}
