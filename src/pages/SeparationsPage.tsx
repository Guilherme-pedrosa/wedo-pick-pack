import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSeparations, invalidateSeparation, linkTechnicianToSeparation, SeparationRecord, SeparationFilters } from '@/api/separations';
import { getOS, getVenda, updateOSStatus, updateVendaStatus } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Loader2, Printer, FileText, UserPlus, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { PickingItem, GCProdutoItem } from '@/api/types';
import SeparationReceipt from '@/components/checkout/SeparationReceipt';
import { supabase } from '@/integrations/supabase/client';

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

        // Only invalidate if order reverted to its ORIGINAL status (before separation)
        // Don't invalidate if order progressed forward (e.g., to "executado")
        if (order.situacao_id === sep.status_id) {
          const reason = `Status revertido no GC: "${order.nome_situacao}" (voltou ao status anterior à separação)`;
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
          <SeparationCard key={sep.id} sep={sep} formatTime={formatTime} formatDateTime={formatDateTime} formatDuration={formatDuration} onUpdated={() => refetch()} />
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
  onUpdated,
}: {
  sep: SeparationRecord;
  formatTime: (iso: string) => string;
  formatDateTime: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
  onUpdated: () => void;
}) {
  const isInvalid = sep.invalidated;
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [receiptItems, setReceiptItems] = useState<PickingItem[]>([]);
  const [receiptEquipment, setReceiptEquipment] = useState<string | undefined>(sep.equipment_name || undefined);

  // Technician link state
  const [techDialogOpen, setTechDialogOpen] = useState(false);
  const [technicians, setTechnicians] = useState<{ id: string; gc_id: string; name: string }[]>([]);
  const [techSearch, setTechSearch] = useState('');
  const [loadingTechs, setLoadingTechs] = useState(false);
  const [linking, setLinking] = useState(false);

  const loadTechnicians = async () => {
    setLoadingTechs(true);
    const { data } = await supabase.from('technicians').select('id, gc_id, name').eq('active', true).order('name');
    setTechnicians(data || []);
    setLoadingTechs(false);
  };

  const openTechDialog = () => {
    setTechDialogOpen(true);
    setTechSearch('');
    loadTechnicians();
  };

  const RETIRADA_TECNICO_STATUS_ID = '7684665';

  const handleLinkTechnician = async (tech: { gc_id: string; name: string } | null) => {
    setLinking(true);
    try {
      const ok = await linkTechnicianToSeparation(
        sep.id,
        tech?.gc_id || null,
        tech?.name || null
      );
      if (!ok) {
        toast.error('Erro ao vincular técnico');
        setLinking(false);
        return;
      }

      // When linking (not unlinking) a technician to an OS, update GC status to "Retirada pelo técnico"
      if (tech && sep.order_type === 'os') {
        try {
          const order = await getOS(sep.order_id);
          if (order) {
            await updateOSStatus(sep.order_id, order, RETIRADA_TECNICO_STATUS_ID);
            toast.success(`Técnico "${tech.name}" vinculado e status alterado para "Retirada pelo técnico"`);
          } else {
            toast.success(`Técnico "${tech.name}" vinculado (OS não encontrada no GC para alterar status)`);
          }
        } catch (err) {
          console.error('Error updating OS status to Retirada pelo técnico:', err);
          toast.warning(`Técnico vinculado, mas erro ao alterar status no GC: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        }
      } else {
        toast.success(tech ? `Técnico "${tech.name}" vinculado` : 'Técnico desvinculado');
      }

      setTechDialogOpen(false);
      onUpdated();
    } finally {
      setLinking(false);
    }
  };

  const filteredTechs = technicians.filter(t =>
    t.name.toLowerCase().includes(techSearch.toLowerCase())
  );

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
            {!isInvalid && (
              <Button
                variant="ghost"
                size="sm"
                onClick={openTechDialog}
                className="h-7 px-2 text-xs"
              >
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                {sep.technician_name ? 'Alterar' : 'Vincular'} Técnico
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
        {sep.technician_name && (
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <User className="h-3 w-3" /> {sep.technician_name}
          </p>
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

      <Dialog open={techDialogOpen} onOpenChange={setTechDialogOpen}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <UserPlus className="h-4 w-4" />
              Vincular Técnico — #{sep.order_code}
            </DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Buscar técnico..."
            value={techSearch}
            onChange={(e) => setTechSearch(e.target.value)}
            autoFocus
          />
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {loadingTechs && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingTechs && filteredTechs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum técnico encontrado</p>
            )}
            {filteredTechs.map(tech => (
              <div
                key={tech.id}
                className={`flex items-center justify-between p-2 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer ${sep.technician_gc_id === tech.gc_id ? 'bg-primary/10 border-primary' : ''}`}
                onClick={() => handleLinkTechnician(tech)}
              >
                <div>
                  <p className="text-sm font-medium">{tech.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">ID: {tech.gc_id}</p>
                </div>
                {sep.technician_gc_id === tech.gc_id && (
                  <Badge variant="default" className="text-xs">Atual</Badge>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="flex-row gap-2">
            {sep.technician_gc_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleLinkTechnician(null)}
                disabled={linking}
                className="text-destructive"
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Desvincular
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setTechDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
