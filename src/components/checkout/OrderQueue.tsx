import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listOS, listVendas, getOS, getVenda, getStatusOS, getStatusVendas, enrichOrderProducts, checkStockForOrders } from '@/api/gestaoclick';
import { getValidSeparatedOrderIds } from '@/api/separations';
import { useCheckoutStore } from '@/store/checkoutStore';
import { OrderType, GCOrdemServico, GCVenda } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, ChevronLeft, ChevronRight, ClipboardList, ShoppingCart, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';

export default function OrderQueue() {
  const [activeType, setActiveType] = useState<OrderType>('os');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirmSwitch, setConfirmSwitch] = useState<{ tipo: OrderType; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockScanning, setStockScanning] = useState(false);
  const [stockProgress, setStockProgress] = useState({ checked: 0, total: 0 });
  const [stockFilter, setStockFilter] = useState<Set<string> | null>(null); // null = not scanned

  const session = useCheckoutStore(s => s.session);
  const startSession = useCheckoutStore(s => s.startSession);
  const cancelSession = useCheckoutStore(s => s.cancelSession);
  const config = useCheckoutStore(s => s.config);

  // Fetch valid (non-invalidated) separated order IDs from DB
  const separatedQuery = useQuery({
    queryKey: ['valid-separated-ids'],
    queryFn: getValidSeparatedOrderIds,
    refetchInterval: 15000, // re-check every 15s
  });
  const separatedIds = separatedQuery.data || new Set<string>();

  const statusQuery = useQuery({
    queryKey: ['statuses', activeType],
    queryFn: () => activeType === 'os' ? getStatusOS() : getStatusVendas(),
  });

  const filterStatusId = statusFilter === 'all' ? undefined : statusFilter;

  const ordersQuery = useQuery({
    queryKey: ['orders', activeType, filterStatusId, page],
    queryFn: () => activeType === 'os' ? listOS(filterStatusId, page) : listVendas(filterStatusId, page),
  });

  const orders = ordersQuery.data?.data || [];
  const meta = ordersQuery.data?.meta;

  // Filter by config status
  const configStatuses = activeType === 'os' ? config.osStatusToShow : config.vendaStatusToShow;
  const filteredByConfig = configStatuses.length > 0
    ? orders.filter(o => configStatuses.includes(o.situacao_id))
    : orders;

  // Stock filter
  const filteredByStock = stockFilter
    ? filteredByConfig.filter(o => stockFilter.has(o.id))
    : filteredByConfig;

  // Debounce search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Client-side search (uses debounced value)
  const filtered = useMemo(() => {
    const s = debouncedSearch.trim().toLowerCase();
    if (!s) return filteredByStock;
    return filteredByStock.filter(o =>
      o.codigo.toLowerCase().includes(s) ||
      o.nome_cliente.toLowerCase().includes(s)
    );
  }, [filteredByStock, debouncedSearch]);

  const handleStockScan = useCallback(async () => {
    if (filteredByConfig.length === 0) {
      toast.warning('Nenhum pedido para varrer');
      return;
    }
    setStockScanning(true);
    setStockProgress({ checked: 0, total: 0 });
    try {
      const result = await checkStockForOrders(filteredByConfig, (checked, total) => {
        setStockProgress({ checked, total });
      });
      setStockFilter(result);
      const removed = filteredByConfig.length - result.size;
      toast.success(`Varredura concluída! ${result.size} pedidos com estoque, ${removed} sem estoque completo.`);
    } catch (err) {
      toast.error('Erro durante varredura de estoque');
    } finally {
      setStockScanning(false);
    }
  }, [filteredByConfig]);

  const handleOrderClick = useCallback(async (tipo: OrderType, id: string) => {
    if (session && session.refId !== id && !session.concludedAt) {
      setConfirmSwitch({ tipo, id });
      return;
    }
    await loadAndStart(tipo, id);
  }, [session]);

  const loadAndStart = async (tipo: OrderType, id: string) => {
    setLoading(true);
    try {
      const order = tipo === 'os' ? await getOS(id) : await getVenda(id);
      // Enrich products with barcode/code details
      const enrichedProdutos = await enrichOrderProducts(order.produtos);
      order.produtos = enrichedProdutos;
      startSession(tipo, order);
    } catch (err) {
      toast.error('Erro ao carregar pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!confirmSwitch) return;
    cancelSession();
    await loadAndStart(confirmSwitch.tipo, confirmSwitch.id);
    setConfirmSwitch(null);
  };

  function getOrderBadge(order: GCOrdemServico | GCVenda) {
    if (session && session.refId === order.id && session.tipo === activeType && !session.concludedAt) {
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">Em andamento</Badge>;
    }
    if (separatedIds.has(order.id)) {
      return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Concluído ✓</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">Aguardando</Badge>;
  }

  const formatDate = (d: string) => {
    try {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y}`;
    } catch {
      return d;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="sticky top-0 bg-card z-10 p-3 space-y-2 border-b border-border">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={activeType === 'os' ? 'default' : 'outline'}
            className="text-sm gap-1.5"
            onClick={() => { setActiveType('os'); setPage(1); setStatusFilter('all'); }}
          >
            <ClipboardList className="h-4 w-4" /> Ordens de Serviço
          </Button>
          <Button
            variant={activeType === 'venda' ? 'default' : 'outline'}
            className="text-sm gap-1.5"
            onClick={() => { setActiveType('venda'); setPage(1); setStatusFilter('all'); }}
          >
            <ShoppingCart className="h-4 w-4" /> Vendas
          </Button>
        </div>

        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full text-sm">
            <SelectValue placeholder="Todas as situações" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {(statusQuery.data || []).map(s => (
              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Buscar por código ou cliente…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-sm"
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 text-sm gap-1.5"
            onClick={() => { ordersQuery.refetch(); separatedQuery.refetch(); setStockFilter(null); }}
            disabled={ordersQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${ordersQuery.isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            className="flex-1 text-sm gap-1.5"
            onClick={handleStockScan}
            disabled={stockScanning || ordersQuery.isLoading}
          >
            <PackageSearch className={`h-4 w-4 ${stockScanning ? 'animate-pulse' : ''}`} />
            Varredura de estoque
          </Button>
        </div>

        {stockScanning && (
          <div className="space-y-1">
            <Progress value={stockProgress.total > 0 ? (stockProgress.checked / stockProgress.total) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Verificando estoque… {stockProgress.checked}/{stockProgress.total} produtos
            </p>
          </div>
        )}

        {stockFilter && !stockScanning && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Mostrando {stockFilter.size} pedidos com estoque
            </p>
            <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setStockFilter(null)}>
              Limpar filtro
            </Button>
          </div>
        )}
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {ordersQuery.isLoading && (
          <div className="text-center text-muted-foreground py-8">Carregando...</div>
        )}
        {!ordersQuery.isLoading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-8">Nenhum pedido encontrado</div>
        )}
        {filtered.map(order => {
          const isActive = session && session.refId === order.id && session.tipo === activeType && !session.concludedAt;
          return (
            <Card
              key={order.id}
              className={`p-3 cursor-pointer transition-all hover:shadow-md ${
                isActive
                  ? 'border-l-4 border-l-secondary bg-blue-50'
                  : 'border-l-4 border-l-transparent'
              } ${loading ? 'pointer-events-none opacity-50' : ''}`}
              onClick={() => handleOrderClick(activeType, order.id)}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs font-bold px-2 py-0.5 ${
                    activeType === 'os' ? 'bg-primary text-primary-foreground' : 'bg-purple-700 text-primary-foreground'
                  }`}>
                    {activeType === 'os' ? 'OS' : 'VENDA'}
                  </Badge>
                  <span className="font-semibold text-sm">#{order.codigo}</span>
                </div>
                {getOrderBadge(order)}
              </div>
              <p className="text-sm font-medium text-foreground truncate">{order.nome_cliente}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <span>{order.nome_situacao}</span>
                <span>·</span>
                <span>{formatDate(order.data)}</span>
                <span>·</span>
                <span className="font-medium text-foreground">R$ {order.valor_total}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {meta && meta.total_paginas > 1 && (
        <div className="p-3 border-t border-border flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {meta.pagina_atual} de {meta.total_paginas}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.total_paginas} onClick={() => setPage(p => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Confirm switch dialog */}
      <Dialog open={!!confirmSwitch} onOpenChange={() => setConfirmSwitch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abandonar separação atual?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Há uma separação em andamento para <strong>#{session?.codigo}</strong>. Deseja abandoná-la e iniciar esta?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSwitch(null)}>Cancelar</Button>
            <Button onClick={handleConfirmSwitch}>Sim, iniciar nova</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
