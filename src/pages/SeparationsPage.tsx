import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSeparations, invalidateSeparation, SeparationRecord, SeparationFilters } from '@/api/separations';
import { getOS, getVenda } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Loader2, Printer, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { PickingItem, GCProdutoItem } from '@/api/types';
import SeparationReceipt from '@/components/checkout/SeparationReceipt';

export default function SeparationsPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ checked: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [orderType, setOrderType] = useState<'all' | 'os' | 'venda'>('all');
  const [status, setStatus] = useState<'all' | 'valid' | 'invalid'>('all');

  const filters = useMemo<SeparationFilters>(() => ({
    search: search.trim() || undefined,
    fromDate: fromDate ? toStartOfDayIso(fromDate) : undefined,
    toDate: toDate ? toNextDayStartIso(toDate) : undefined,
    orderType,
    status,
  }), [search, fromDate, toDate, orderType, status]);

  const { data: separations = [], isLoading, refetch } = useQuery({
    queryKey: ['separations', filters],
    queryFn: () => getSeparations(filters),
    refetchInterval: 30000,
  });

  const clearFilters = () => {
    setSearch('');
    setFromDate('');
    setToDate('');
    setOrderType('all');
    setStatus('all');
  };

  const validSeparations = separations.filter(s => !s.invalidated);
  const validCount = validSeparations.length;
  const invalidCount = separations.filter(s => s.invalidated).length;

  const syncWithGC = useCallback(async () => {
    const active = separations.filter(s => !s.invalidated);
    if (active.length === 0) {
      toast.info('Nenhuma separação ativa para verificar');
      return;
    }

    setSyncing(true);
    setSyncProgress({ checked: 0, total: active.length });
    let invalidated = 0;

    for (let i = 0; i < active.length; i++) {
      const sep = active[i];
      try {
        const order = sep.order_type === 'os'
          ? await getOS(sep.order_id)
          : await getVenda(sep.order_id);

        if (order.situacao_id !== sep.target_status_id) {
          const reason = `Status alterado no GC: "${order.nome_situacao}" (era "${sep.target_status_name}")`;
          await invalidateSeparation(sep.id, reason);
          invalidated++;
        }
      } catch (err) {
        console.error(`Error checking order ${sep.order_code}:`, err);
      }

      setSyncProgress({ checked: i + 1, total: active.length });

      if (i < active.length - 1) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    await refetch();
    setSyncing(false);
    queryClient.invalidateQueries({ queryKey: ['valid-separated-ids'] });

    if (invalidated > 0) {
      toast.warning(`${invalidated} separação(ões) invalidada(s) por mudança de status no GC`);
    } else {
      toast.success('Todas as separações estão válidas!');
    }
  }, [separations, refetch, queryClient]);

  const handlePrint = () => {
    window.print();
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch  {
      return iso;
    }
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const formatDuration = (start: string, end: string) => {
    try {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      return `${mins}min ${secs}s`;
    } catch {
      return '';
    }
  };

  const reportGeneratedAt = new Date().toLocaleString('pt-BR');

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      {/* Screen-only controls */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-primary" />
            Histórico de Separações
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {separations.length} resultado(s) — {validCount} válida(s), {invalidCount} invalidada(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={syncWithGC}
            disabled={syncing || isLoading}
          >
            {syncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-1.5" />}
            Verificar no GC
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={isLoading || separations.length === 0}
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Imprimir
          </Button>
        </div>
      </div>

      <Card className="p-3 print:hidden">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Buscar</p>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Código ou cliente"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Data inicial</p>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Data final</p>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Tipo</p>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as 'all' | 'os' | 'venda')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Todos</option>
              <option value="os">OS</option>
              <option value="venda">Venda</option>
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Situação</p>
            <div className="flex gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'all' | 'valid' | 'invalid')}
                className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todas</option>
                <option value="valid">Válidas</option>
                <option value="invalid">Invalidadas</option>
              </select>
              <Button variant="outline" onClick={clearFilters}>
                Limpar
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Print header - only visible when printing */}
      <div className="hidden print:block print:mb-6">
        <div className="text-center border-b-2 border-foreground pb-3 mb-4">
          <h1 className="text-2xl font-bold">📦 Relatório de Separações</h1>
          <p className="text-sm mt-1">Gerado em {reportGeneratedAt}</p>
          <p className="text-sm">
            {validCount} separação(ões) válida(s) • {invalidCount} invalidada(s)
          </p>
        </div>
      </div>

      {syncing && (
        <div className="space-y-1 print:hidden">
          <Progress value={syncProgress.total > 0 ? (syncProgress.checked / syncProgress.total) * 100 : 0} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Verificando {syncProgress.checked}/{syncProgress.total} separações no GestãoClick…
          </p>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-muted-foreground py-12 print:hidden">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Carregando separações…
        </div>
      )}

      {!isLoading && separations.length === 0 && (
        <Card className="p-8 text-center print:hidden">
          <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">Nenhuma separação encontrada com os filtros atuais</p>
        </Card>
      )}

      {/* Print-friendly table - only visible when printing */}
      <div className="hidden print:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground">
              <th className="text-left py-2 px-1">Tipo</th>
              <th className="text-left py-2 px-1">Código</th>
              <th className="text-left py-2 px-1">Cliente</th>
              <th className="text-center py-2 px-1">Itens</th>
              <th className="text-right py-2 px-1">Valor</th>
              <th className="text-left py-2 px-1">Status</th>
              <th className="text-left py-2 px-1">Operador</th>
              <th className="text-center py-2 px-1">Hora</th>
              <th className="text-center py-2 px-1">Situação</th>
            </tr>
          </thead>
          <tbody>
            {separations.map((sep, i) => (
              <tr key={sep.id} className={`border-b ${sep.invalidated ? 'line-through opacity-50' : ''}`}>
                <td className="py-1.5 px-1 font-medium">{sep.order_type === 'os' ? 'OS' : 'VD'}</td>
                <td className="py-1.5 px-1 font-bold">#{sep.order_code}</td>
                <td className="py-1.5 px-1 max-w-[200px] truncate">{sep.client_name}</td>
                <td className="py-1.5 px-1 text-center">{sep.items_confirmed}/{sep.items_total}</td>
                <td className="py-1.5 px-1 text-right">R$ {sep.total_value}</td>
                <td className="py-1.5 px-1 text-xs">{sep.status_name} → {sep.target_status_name}</td>
                <td className="py-1.5 px-1">{sep.operator_name || '—'}</td>
                <td className="py-1.5 px-1 text-center">{formatTime(sep.concluded_at)}</td>
                <td className="py-1.5 px-1 text-center">{sep.invalidated ? '❌' : '✅'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Print summary */}
        <div className="mt-4 pt-3 border-t-2 border-foreground text-sm">
          <div className="flex justify-between">
            <span><strong>Total de separações:</strong> {separations.length}</span>
            <span><strong>Válidas:</strong> {validCount}</span>
            <span><strong>Invalidadas:</strong> {invalidCount}</span>
            <span><strong>Valor total (válidas):</strong> R$ {
              validSeparations.reduce((sum, s) => sum + parseFloat(s.total_value || '0'), 0).toFixed(2)
            }</span>
          </div>
        </div>
      </div>

      {/* Screen cards */}
      <div className="space-y-3 print:hidden">
        {separations.map(sep => (
          <SeparationCard key={sep.id} sep={sep} formatTime={formatTime} formatDateTime={formatDateTime} formatDuration={formatDuration} />
        ))}
      </div>
    </div>
  );
}

function toStartOfDayIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

function toNextDayStartIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day + 1, 0, 0, 0, 0).toISOString();
}

function parseGCQuantity(val: string | number): number {
  if (typeof val === 'number') return val;
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

function buildPickingItemsFromOrder(orderId: string, produtos: Array<{ produto: GCProdutoItem }>): PickingItem[] {
  return (produtos || []).map((p, i) => ({
    id: `${orderId}-${i}`,
    produto_id: p.produto.produto_id,
    variacao_id: p.produto.variacao_id,
    nome_produto: p.produto.nome_produto,
    codigo_produto: p.produto.codigo_produto,
    codigo_barras: p.produto.codigo_barras,
    sigla_unidade: p.produto.sigla_unidade,
    qtd_total: parseGCQuantity(p.produto.quantidade),
    qtd_conferida: parseGCQuantity(p.produto.quantidade),
    conferido: true,
    localizacao_fisica: p.produto.localizacao_fisica,
    localizacao_rational: p.produto.localizacao_rational,
  }));
}

function SeparationCard({
  sep,
  formatTime,
  formatDateTime,
  formatDuration,
}: {
  sep: SeparationRecord;
  formatTime: (iso: string) => string;
  formatDateTime: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
}) {
  const isInvalid = sep.invalidated;
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [receiptItems, setReceiptItems] = useState<PickingItem[]>([]);
  const [receiptEquipment, setReceiptEquipment] = useState<string | undefined>(sep.equipment_name || undefined);

  const handleReprint = async () => {
    setLoadingReceipt(true);
    try {
      const order = sep.order_type === 'os'
        ? await getOS(sep.order_id)
        : await getVenda(sep.order_id);
      const items = buildPickingItemsFromOrder(sep.order_id, order.produtos);
      setReceiptItems(items);
      // Extract equipment from live GC data if not stored in separation record
      if (!sep.equipment_name && 'equipamentos' in order && Array.isArray(order.equipamentos) && order.equipamentos.length > 0) {
        const eqName = order.equipamentos
          .map((e: any) => e.equipamento?.equipamento || '')
          .filter(Boolean)
          .join(', ');
        if (eqName) setReceiptEquipment(eqName);
      }
      setReceiptOpen(true);
    } catch (err) {
      console.error('Error fetching order for reprint:', err);
      toast.error('Erro ao buscar dados do pedido para reimprimir');
    } finally {
      setLoadingReceipt(false);
    }
  };

  return (
    <>
      <Card className={`p-4 transition-all ${isInvalid ? 'opacity-60 border-l-4 border-l-destructive' : 'border-l-4 border-l-green-500'}`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {isInvalid ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            <Badge className={sep.order_type === 'os' ? 'bg-primary text-primary-foreground' : 'bg-purple-700 text-primary-foreground'}>
              {sep.order_type === 'os' ? 'OS' : 'VENDA'}
            </Badge>
            <span className="font-bold text-sm">#{sep.order_code}</span>
            {isInvalid && (
              <Badge variant="destructive" className="text-xs">
                Invalidada
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isInvalid && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReprint}
                disabled={loadingReceipt}
                className="h-7 px-2 text-xs"
              >
                {loadingReceipt ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <FileText className="h-3.5 w-3.5 mr-1" />
                )}
                Reimprimir
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDateTime(sep.concluded_at)}
            </span>
          </div>
        </div>

        <p className="text-sm font-medium text-foreground mb-1">{sep.client_name}</p>
        {sep.equipment_name && (
          <p className="text-xs text-muted-foreground mb-1">🔧 {sep.equipment_name}</p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Itens:</span> {sep.items_confirmed}/{sep.items_total}
          </div>
          <div>
            <span className="font-medium text-foreground">Valor:</span> R$ {sep.total_value}
          </div>
          <div>
            <span className="font-medium text-foreground">Operador:</span> {sep.operator_name || '—'}
          </div>
          <div>
            <span className="font-medium text-foreground">Duração:</span> {formatDuration(sep.started_at, sep.concluded_at)}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 text-xs">
          <span className="text-muted-foreground">{sep.status_name}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium text-foreground">{sep.target_status_name}</span>
        </div>

        {isInvalid && sep.invalidated_reason && (
          <div className="mt-2 bg-destructive/10 text-destructive rounded p-2 text-xs">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            {sep.invalidated_reason}
          </div>
        )}

        {sep.observations && (
          <div className="mt-2 bg-muted rounded p-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Obs:</span> {sep.observations}
          </div>
        )}
      </Card>

      {receiptOpen && (
        <SeparationReceipt
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          orderType={sep.order_type}
          orderCode={sep.order_code}
          clientName={sep.client_name}
          operatorName={sep.operator_name}
          equipmentName={receiptEquipment}
          items={receiptItems}
          startedAt={sep.started_at}
          concludedAt={sep.concluded_at}
          observations={sep.observations || undefined}
        />
      )}
    </>
  );
}
