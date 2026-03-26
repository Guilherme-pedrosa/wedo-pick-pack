import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listOS, listVendas, listOSMultiStatus, listVendasMultiStatus, getOS, getVenda, getStatusOS, getStatusVendas, enrichOrderProducts, checkStockForOrders, StockConflict } from '@/api/gestaoclick';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RefreshCw, ChevronLeft, ChevronRight, ClipboardList, ShoppingCart, PackageSearch, ArrowUpDown, AlertTriangle, ChevronDown, Filter } from 'lucide-react';
import { toast } from 'sonner';

type SortField = 'codigo' | 'cliente' | 'data' | 'valor';

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
  const [stockFilter, setStockFilter] = useState<Set<string> | null>(null);
  const [stockConflicts, setStockConflicts] = useState<StockConflict[]>([]);
  const [sortField, setSortField] = useState<SortField>('codigo');
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const queryClient = useQueryClient();
  const session = useCheckoutStore(s => s.session);
  const startSession = useCheckoutStore(s => s.startSession);
  const cancelSession = useCheckoutStore(s => s.cancelSession);
  const config = useCheckoutStore(s => s.config);

  // Fetch valid (non-invalidated) separated order IDs from DB
  const separatedQuery = useQuery({
    queryKey: ['valid-separated-ids'],
    queryFn: getValidSeparatedOrderIds,
    refetchInterval: 60000, // re-check every 60s (was 15s — too aggressive)
    staleTime: 30000, // consider fresh for 30s
    refetchOnWindowFocus: false,
  });
  const separatedIds = separatedQuery.data || new Set<string>();

  const statusQuery = useQuery({
    queryKey: ['statuses', activeType],
    queryFn: () => activeType === 'os' ? getStatusOS() : getStatusVendas(),
    staleTime: 5 * 60 * 1000, // statuses rarely change — cache 5 min
    refetchOnWindowFocus: false,
  });

  const filterStatusId = statusFilter === 'all' ? undefined : statusFilter;
  const searchTerm = debouncedSearch.trim();
  const configStatuses = activeType === 'os' ? config.osStatusToShow : config.vendaStatusToShow;

  // When no manual status filter and config statuses exist, use multi-status fetch
  // This sends situacao_id directly to the API so pagination works correctly
  const useMultiStatus = !filterStatusId && configStatuses.length > 0;

  const ordersQuery = useQuery({
    queryKey: ['orders', activeType, filterStatusId, page, searchTerm, useMultiStatus ? configStatuses.join(',') : ''],
    queryFn: () => {
      if (useMultiStatus) {
        return activeType === 'os'
          ? listOSMultiStatus(configStatuses, searchTerm || undefined)
          : listVendasMultiStatus(configStatuses, searchTerm || undefined);
      }
      return activeType === 'os'
        ? listOS(filterStatusId, page, searchTerm || undefined)
        : listVendas(filterStatusId, page, searchTerm || undefined);
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const orders = ordersQuery.data?.data || [];
  const meta = ordersQuery.data?.meta;

  // No more client-side config filtering needed — it's done server-side now
  const filteredByConfig = orders;

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
    let result = s
      ? filteredByStock.filter(o =>
          o.codigo.toLowerCase().includes(s) ||
          o.nome_cliente.toLowerCase().includes(s)
        )
      : [...filteredByStock];

    // Sort
    result.sort((a, b) => {
      switch (sortField) {
        case 'cliente':
          return (a.nome_cliente || '').localeCompare(b.nome_cliente || '');
        case 'data': {
          const da = (a as any).data_entrada || (a as any).data || '';
          const db = (b as any).data_entrada || (b as any).data || '';
          return db.localeCompare(da);
        }
        case 'valor':
          return parseFloat(b.valor_total || '0') - parseFloat(a.valor_total || '0');
        case 'codigo':
        default:
          return (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true });
      }
    });

    return result;
  }, [filteredByStock, debouncedSearch, sortField]);

  // Compute which orders can't be fulfilled because stock ran out (allocated to earlier orders by code)
  const outOfStockOrderIds = useMemo(() => {
    if (stockConflicts.length === 0) return new Set<string>();

    // For each conflicted product, allocate stock to orders sorted by code (ascending)
    // Orders that already got separated consume stock first
    const orderDeficits = new Map<string, boolean>(); // orderId -> has deficit

    for (const conflict of stockConflicts) {
      let remaining = conflict.estoque;

      // Sort pedidos by codigo ascending (earlier orders get priority)
      const sorted = [...conflict.pedidos].sort((a, b) =>
        a.codigo.localeCompare(b.codigo, undefined, { numeric: true })
      );

      for (const p of sorted) {
        // Find the order id from filtered list
        const order = filteredByConfig.find(o => o.codigo === p.codigo);
        if (!order) continue;

        // If already separated, this order consumed stock
        if (separatedIds.has(order.id)) {
          remaining -= p.qtd;
          continue;
        }

        // Check if this order can be fulfilled
        if (remaining < p.qtd) {
          orderDeficits.set(order.id, true);
        }
        remaining -= p.qtd;
      }
    }

    return new Set(orderDeficits.keys());
  }, [stockConflicts, filteredByConfig, separatedIds]);

  const handleStockScan = useCallback(async () => {
    if (filteredByConfig.length === 0) {
      toast.warning('Nenhum pedido para varrer');
      return;
    }
    setStockScanning(true);
    setStockProgress({ checked: 0, total: 0 });
    try {
      const scanResult = await checkStockForOrders(filteredByConfig, (checked, total) => {
        setStockProgress({ checked, total });
      });
      setStockFilter(scanResult.fullStockOrders);
      setStockConflicts(scanResult.conflicts);
      const removed = filteredByConfig.length - scanResult.fullStockOrders.size;
      if (scanResult.conflicts.length > 0) {
        const msg = `Varredura concluída! ${scanResult.fullStockOrders.size} pedidos com estoque, ${removed} sem estoque completo. ⚠️ ${scanResult.conflicts.length} conflito(s) de estoque encontrado(s)!`;
        toast.warning(msg, { duration: 8000 });
      } else if (removed === 0) {
        toast.success('✅ Todos os pedidos possuem estoque completo e sem conflitos de quantidade!', { duration: 6000 });
      } else {
        toast.success(`Varredura concluída! ${scanResult.fullStockOrders.size} pedidos com estoque, ${removed} sem estoque completo.`);
      }
    } catch (err) {
      toast.error('Erro durante varredura de estoque');
    } finally {
      setStockScanning(false);
    }
  }, [filteredByConfig]);

  const loadAndStart = useCallback(async (tipo: OrderType, id: string) => {
    setLoading(true);
    try {
      const order = tipo === 'os' ? await getOS(id) : await getVenda(id);
      const enrichedProdutos = await enrichOrderProducts(order.produtos);
      order.produtos = enrichedProdutos;
      startSession(tipo, order);
    } catch (err) {
      toast.error('Erro ao carregar pedido');
    } finally {
      setLoading(false);
    }
  }, [startSession]);

  const handleOrderClick = useCallback(async (tipo: OrderType, id: string) => {
    // Block already-separated orders
    if (separatedIds.has(id)) {
      toast.info('Esta OS já foi separada.');
      return;
    }
    if (session && session.refId !== id && !session.concludedAt) {
      setConfirmSwitch({ tipo, id });
      return;
    }
    await loadAndStart(tipo, id);
  }, [session, loadAndStart, separatedIds]);

  const handleConfirmSwitch = useCallback(async () => {
    if (!confirmSwitch) return;
    cancelSession();
    await loadAndStart(confirmSwitch.tipo, confirmSwitch.id);
    setConfirmSwitch(null);
  }, [confirmSwitch, cancelSession, loadAndStart]);

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

        {/* Collapsible filters */}
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full flex items-center justify-between text-xs h-7 px-2">
              <span className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" /> Filtros
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-1">
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
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="text-sm"
            />

            {/* Sort selector */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="codigo">Código (mais antigo)</SelectItem>
                  <SelectItem value="cliente">Cliente (A-Z)</SelectItem>
                  <SelectItem value="data">Data (mais recente)</SelectItem>
                  <SelectItem value="valor">Valor (maior)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 text-sm gap-1.5"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['orders'] });
              queryClient.invalidateQueries({ queryKey: ['statuses'] });
              separatedQuery.refetch();
              setStockFilter(null);
              setStockConflicts([]);
              toast.info('Atualizando pedidos do GestãoClick…');
            }}
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
            <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => { setStockFilter(null); setStockConflicts([]); }}>
              Limpar filtro
            </Button>
          </div>
        )}

        {/* Collapsible stock conflicts */}
        {stockConflicts.length > 0 && !stockScanning && (
          <Collapsible open={conflictsOpen} onOpenChange={setConflictsOpen}>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="text-xs font-semibold text-amber-800">
                      {stockConflicts.length} conflito(s) de estoque
                    </span>
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-amber-600 transition-transform ${conflictsOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 mt-1.5">
                {stockConflicts.map(c => (
                  <div key={c.produto_id} className="text-[10px] text-amber-900 bg-amber-100/50 rounded px-1.5 py-1">
                    <p className="font-medium">{c.nome_produto}</p>
                    <p>Estoque: {c.estoque} · Demanda: {c.demanda_total}</p>
                    <div className="mt-0.5 space-y-0.5">
                      {c.pedidos.map((p, i) => (
                        <p key={i}>#{p.codigo} — {p.nome_cliente} — precisa {p.qtd}</p>
                      ))}
                    </div>
                    {c.pedidos_compra.length > 0 ? (
                      <div className="mt-1 pt-1 border-t border-amber-300/50">
                        <p className="font-semibold text-green-800">✅ Coberto por pedido de compra:</p>
                        {c.pedidos_compra.map((po, i) => (
                          <p key={i} className="text-green-800">
                            PC #{po.codigo} — {po.nome_fornecedor} — qtd {po.qtd} ({po.situacao})
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 pt-1 border-t border-amber-300/50 font-semibold text-red-700">
                        ❌ Sem pedido de compra
                      </p>
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </div>
          </Collapsible>
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
          const isOutOfStock = outOfStockOrderIds.has(order.id);
          return (
            <Card
              key={order.id}
              className={`p-3 transition-all ${
                separatedIds.has(order.id)
                  ? 'border-l-4 border-l-green-500 opacity-50 cursor-default'
                  : isActive
                    ? 'border-l-4 border-l-secondary bg-blue-50 cursor-pointer hover:shadow-md'
                    : isOutOfStock
                      ? 'border-l-4 border-l-destructive bg-red-50 cursor-pointer hover:shadow-md'
                      : 'border-l-4 border-l-transparent cursor-pointer hover:shadow-md'
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
                <div className="flex items-center gap-1.5">
                  {isOutOfStock && (
                    <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Sem estoque</Badge>
                  )}
                  {getOrderBadge(order)}
                </div>
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
