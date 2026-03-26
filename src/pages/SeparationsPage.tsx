import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSeparations, invalidateSeparation, linkTechnicianToSeparation, SeparationRecord, SeparationFilters } from '@/api/separations';
import { getOS, getVenda, updateOSStatus, updateVendaStatus } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Loader2, Printer, FileText, UserPlus, User, X, Undo2, Calendar, Radio } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils'; // util
import { toast } from 'sonner';
import { PickingItem, GCProdutoItem } from '@/api/types';
import SeparationReceipt from '@/components/checkout/SeparationReceipt';
import { supabase } from '@/integrations/supabase/client';
import { logSystemAction } from '@/lib/systemLog';

export default function SeparationsPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ checked: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [orderType, setOrderType] = useState<'all' | 'os' | 'venda'>('all');
  const [status, setStatus] = useState<'all' | 'valid' | 'invalid'>('all');

  // Live GC status tracking
  const [liveStatuses, setLiveStatuses] = useState<Record<string, { nome_situacao: string; situacao_id: string; fetchedAt: string } | null>>({});
  const [fetchingLive, setFetchingLive] = useState(false);
  const liveStatusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchLiveStatusesAndSync = useCallback(async (opts?: { showToast?: boolean }) => {
    const active = separations.filter(s => !s.invalidated);
    if (active.length === 0) {
      if (opts?.showToast) toast.info('Nenhuma separação ativa para verificar');
      return;
    }

    // Deduplicate by order_id to avoid redundant API calls
    const orderMap = new Map<string, { order_type: string; order_id: string }>();
    for (const sep of active) {
      const key = `${sep.order_type}:${sep.order_id}`;
      if (!orderMap.has(key)) {
        orderMap.set(key, { order_type: sep.order_type, order_id: sep.order_id });
      }
    }
    const uniqueOrders = Array.from(orderMap.values());

    setFetchingLive(true);
    setSyncing(true);
    setSyncProgress({ checked: 0, total: uniqueOrders.length });

    // Fetch each unique order once
    const orderResults = new Map<string, { nome_situacao: string; situacao_id: string }>();
    for (let i = 0; i < uniqueOrders.length; i++) {
      const { order_type, order_id } = uniqueOrders[i];
      try {
        const order = order_type === 'os'
          ? await getOS(order_id)
          : await getVenda(order_id);
        orderResults.set(`${order_type}:${order_id}`, {
          nome_situacao: order.nome_situacao || '—',
          situacao_id: String(order.situacao_id || ''),
        });
      } catch (err) {
        console.error(`Error checking order ${order_id}:`, err);
      }
      setSyncProgress({ checked: i + 1, total: uniqueOrders.length });
      if (i < uniqueOrders.length - 1) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    // Map results back to all separations + check for invalidations
    const liveResults: Record<string, { nome_situacao: string; situacao_id: string; fetchedAt: string } | null> = {};
    let invalidated = 0;
    const now = new Date().toISOString();

    for (const sep of active) {
      const key = `${sep.order_type}:${sep.order_id}`;
      const result = orderResults.get(key);
      if (result) {
        liveResults[sep.id] = { ...result, fetchedAt: now };
        // Invalidate if reverted to original status
        if (result.situacao_id === sep.status_id) {
          try {
            const reason = `Status revertido no GC: "${result.nome_situacao}" (voltou ao status anterior à separação)`;
            await invalidateSeparation(sep.id, reason);
            invalidated++;
          } catch (err) {
            console.error(`Error invalidating sep ${sep.id}:`, err);
          }
        }
      } else {
        liveResults[sep.id] = null;
      }
    }

    setLiveStatuses(prev => ({ ...prev, ...liveResults }));
    setFetchingLive(false);
    setSyncing(false);

    if (invalidated > 0) {
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['valid-separated-ids'] });
      toast.warning(`${invalidated} separação(ões) invalidada(s) por mudança de status no GC`);
    } else if (opts?.showToast) {
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
            variant="outline"
            size="sm"
            onClick={() => fetchLiveStatuses()}
            disabled={fetchingLive || isLoading}
          >
            {fetchingLive ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Radio className="h-4 w-4 mr-1.5" />}
            Status GC
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
            {separations.map((sep, i) => {
              const isReturnRow = sep.invalidated && sep.invalidated_reason?.startsWith('DEVOLUÇÃO:');
              const isInvalidRow = sep.invalidated && !isReturnRow;
              return (
              <tr key={sep.id} className={`border-b ${isInvalidRow ? 'line-through opacity-50' : isReturnRow ? 'opacity-70' : ''}`}>
                <td className="py-1.5 px-1 font-medium">{sep.order_type === 'os' ? 'OS' : 'VD'}</td>
                <td className="py-1.5 px-1 font-bold">#{sep.order_code}</td>
                <td className="py-1.5 px-1 max-w-[200px] truncate">{sep.client_name}</td>
                <td className="py-1.5 px-1 text-center">{sep.items_confirmed}/{sep.items_total}</td>
                <td className="py-1.5 px-1 text-right">R$ {sep.total_value}</td>
                <td className="py-1.5 px-1 text-xs">{sep.status_name} → {sep.target_status_name}</td>
                <td className="py-1.5 px-1">{sep.operator_name || '—'}</td>
                <td className="py-1.5 px-1 text-center">{formatTime(sep.concluded_at)}</td>
                <td className="py-1.5 px-1 text-center">{isInvalidRow ? '❌' : isReturnRow ? '↩️' : '✅'}</td>
              </tr>
              );
            })}
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
          <SeparationCard key={sep.id} sep={sep} formatTime={formatTime} formatDateTime={formatDateTime} formatDuration={formatDuration} onUpdated={() => refetch()} liveStatus={liveStatuses[sep.id] || undefined} />
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
  liveStatus,
}: {
  sep: SeparationRecord;
  formatTime: (iso: string) => string;
  formatDateTime: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
  onUpdated: () => void;
  liveStatus?: { nome_situacao: string; situacao_id: string; fetchedAt: string };
}) {
  const isReturn = sep.invalidated && sep.invalidated_reason?.startsWith('DEVOLUÇÃO:');
  const isInvalid = sep.invalidated && !isReturn;
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
  const [selectedTech, setSelectedTech] = useState<{ gc_id: string; name: string } | null>(null);

  // Return (devolução) state
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnMotivo, setReturnMotivo] = useState<'agenda' | 'peca' | ''>('');
  const [returning, setReturning] = useState(false);
  const [returnTermAccepted, setReturnTermAccepted] = useState(false);

  const DEVOLUCAO_AGENDA_STATUS_ID = '7063705'; // Pedido conferido aguardando execução
  const DEVOLUCAO_PECA_STATUS_ID = '8928768';   // Ag correção

  const handleReturn = async () => {
    if (!returnMotivo) {
      toast.error('Selecione o motivo da devolução');
      return;
    }
    const statusId = returnMotivo === 'agenda' ? DEVOLUCAO_AGENDA_STATUS_ID : DEVOLUCAO_PECA_STATUS_ID;
    const motivoLabel = returnMotivo === 'agenda' ? 'Agenda (não deu tempo)' : 'Peça incorreta';
    const fullReason = returnReason.trim() ? `${motivoLabel} — ${returnReason.trim()}` : motivoLabel;

    setReturning(true);
    try {
      // Get current user's GC usuario_id
      const { data: { user } } = await supabase.auth.getUser();
      let gcUsuarioId: string | undefined;
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('gc_usuario_id').eq('id', user.id).single();
        gcUsuarioId = prof?.gc_usuario_id || undefined;
      }

      if (sep.order_type === 'os') {
        const order = await getOS(sep.order_id);
        if (order) {
          await updateOSStatus(sep.order_id, order, statusId, undefined, gcUsuarioId);
        }
      } else {
        const order = await getVenda(sep.order_id);
        if (order) {
          await updateVendaStatus(sep.order_id, order, statusId, undefined, gcUsuarioId);
        }
      }

      if (returnMotivo === 'agenda') {
        // Agenda: separation stays valid, just log the status change
        await logSystemAction({
          module: 'separations',
          action: 'devolucao_agenda',
          entityType: sep.order_type,
          entityId: sep.order_id,
          entityName: `${sep.order_type === 'os' ? 'OS' : 'Venda'} #${sep.order_code}`,
          details: {
            motivo: fullReason,
            novo_status_id: statusId,
            client_name: sep.client_name,
            separation_id: sep.id,
          },
        });
        toast.success('Status alterado no GC — separação mantida');
        setReturnDialogOpen(false);
        setReturnReason('');
        setReturnMotivo('');
        onUpdated();
      } else {
        // Peça incorreta: invalidate the separation
        const reason = `DEVOLUÇÃO: ${fullReason}`;
        const ok = await invalidateSeparation(sep.id, reason);
        if (ok) {
          toast.success('Devolução registrada e status alterado no GC');
          setReturnDialogOpen(false);
          setReturnReason('');
          setReturnMotivo('');
          onUpdated();
        } else {
          toast.error('Status alterado no GC, mas erro ao registrar devolução localmente');
        }
      }
    } catch (err) {
      console.error('Error processing return:', err);
      toast.error(`Erro ao processar devolução: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    } finally {
      setReturning(false);
    }
  };

  const loadTechnicians = async () => {
    setLoadingTechs(true);
    const { data } = await supabase.from('technicians').select('id, gc_id, name').eq('active', true).order('name');
    setTechnicians(data || []);
    setLoadingTechs(false);
  };

  const openTechDialog = () => {
    setTechDialogOpen(true);
    setTechSearch('');
    setSelectedTech(null);
    loadTechnicians();
  };

  const RETIRADA_TECNICO_STATUS_ID = '7684665';

  const handleLinkTechnician = async (tech: { gc_id: string; name: string } | null) => {
    setLinking(true);
    try {
      // Get current user's GC usuario_id for attribution
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      let gcUsuarioId: string | undefined;
      if (currentUser) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('gc_usuario_id')
          .eq('id', currentUser.id)
          .maybeSingle();
        gcUsuarioId = prof?.gc_usuario_id || undefined;
      }

      // IMPORTANT: for OS, status in GC must be updated BEFORE persisting local technician link
      // so we never keep a local technician linked with stale status.
      if (sep.order_type === 'os') {
        const order = await getOS(sep.order_id);
        const nextStatusId = tech ? RETIRADA_TECNICO_STATUS_ID : sep.target_status_id;
        await updateOSStatus(sep.order_id, order, nextStatusId, undefined, gcUsuarioId);
      }

      const ok = await linkTechnicianToSeparation(
        sep.id,
        tech?.gc_id || null,
        tech?.name || null
      );

      if (!ok) {
        if (sep.order_type === 'os') {
          toast.error('Status alterado no GC, mas falhou ao salvar o vínculo no sistema');
        } else {
          toast.error('Erro ao vincular técnico no sistema');
        }
        return;
      }

      if (sep.order_type === 'os') {
        if (tech) {
          toast.success(`Técnico "${tech.name}" vinculado e status alterado para "Retirada pelo técnico"`);
        } else {
          toast.success(`Técnico desvinculado e status revertido para "${sep.target_status_name}"`);
        }
      } else {
        toast.success(tech ? `Técnico "${tech.name}" vinculado` : 'Técnico desvinculado');
      }

      setTechDialogOpen(false);
      onUpdated();
    } catch (err) {
      console.error('Error linking technician:', err);
      toast.error(`Não foi possível ${tech ? 'vincular' : 'desvincular'} técnico: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
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
      <Card className={`p-4 transition-all ${isInvalid ? 'opacity-60 border-l-4 border-l-destructive' : isReturn ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-green-500'}`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {isInvalid ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : isReturn ? (
              <Undo2 className="h-5 w-5 text-amber-600" />
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
            {isReturn && (
              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                Devolvido
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isInvalid && !isReturn && (
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
            {!isInvalid && !isReturn && (
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
            {!isInvalid && !isReturn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setReturnDialogOpen(true); setReturnReason(''); setReturnTermAccepted(false); }}
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1" />
                Devolução
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
          {sep.technician_name && sep.order_type === 'os' ? (
            <span className="font-medium text-primary">RETIRADA PELO TÉCNICO</span>
          ) : (
            <span className="font-medium text-foreground">{sep.target_status_name}</span>
          )}
        </div>

        {/* Live GC status - informational */}
        {liveStatus && !isInvalid && !isReturn && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  <Radio className="h-3 w-3 text-green-500 animate-pulse" />
                  <span className="text-muted-foreground">Status atual GC:</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium">
                    {liveStatus.nome_situacao}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Atualizado em {new Date(liveStatus.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {isInvalid && sep.invalidated_reason && (
          <div className="mt-2 bg-destructive/10 text-destructive rounded p-2 text-xs">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            {sep.invalidated_reason}
          </div>
        )}

        {isReturn && sep.invalidated_reason && (
          <div className="mt-2 bg-amber-50 text-amber-800 border border-amber-200 rounded p-2 text-xs">
            <Undo2 className="h-3 w-3 inline mr-1" />
            {sep.invalidated_reason.replace(/^DEVOLUÇÃO:\s*/, 'Motivo: ')}
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
          technicianName={sep.technician_name || undefined}
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
                className={`flex items-center justify-between p-2 rounded-lg border transition-colors cursor-pointer ${
                  selectedTech?.gc_id === tech.gc_id
                    ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
                    : sep.technician_gc_id === tech.gc_id
                    ? 'bg-accent/30 border-accent'
                    : 'border-border hover:bg-accent/50'
                }`}
                onClick={() => setSelectedTech(tech)}
              >
                <div>
                  <p className="text-sm font-medium">{tech.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">ID: {tech.gc_id}</p>
                </div>
                {sep.technician_gc_id === tech.gc_id && !selectedTech && (
                  <Badge variant="default" className="text-xs">Atual</Badge>
                )}
                {selectedTech?.gc_id === tech.gc_id && (
                  <Badge variant="default" className="text-xs">Selecionado</Badge>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {selectedTech && (
              <Button
                size="sm"
                onClick={() => handleLinkTechnician(selectedTech)}
                disabled={linking}
                className="w-full"
              >
                {linking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                )}
                Confirmar — {selectedTech.name}
              </Button>
            )}
            <div className="flex gap-2 w-full">
              {sep.technician_gc_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLinkTechnician(null)}
                  disabled={linking}
                  className="text-destructive flex-1"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Desvincular
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setTechDialogOpen(false)} className="flex-1">
                Fechar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Undo2 className="h-4 w-4 text-destructive" />
              Devolução — #{sep.order_code}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Selecione o motivo da devolução. O status será alterado no GestãoClick conforme o motivo escolhido.
            </p>

            {/* Motivo selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Motivo</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setReturnMotivo('agenda')}
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border text-left text-xs transition-colors',
                    returnMotivo === 'agenda'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  <Calendar className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Agenda (não deu tempo)</p>
                    <p className="text-muted-foreground">Volta para "Pedido conferido aguardando execução"</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setReturnMotivo('peca')}
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border text-left text-xs transition-colors',
                    returnMotivo === 'peca'
                      ? 'border-destructive bg-destructive/5 ring-1 ring-destructive'
                      : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Peça incorreta</p>
                    <p className="text-muted-foreground">Volta para "Ag. correção"</p>
                  </div>
                </button>
              </div>
            </div>

            <Textarea
              placeholder="Observações adicionais (opcional)..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={2}
            />
            <div className="border border-border rounded-lg p-3 bg-muted/50 text-xs leading-relaxed space-y-2">
              <p className="font-bold text-foreground uppercase text-[11px]">Termo de Recebimento de Devolução</p>
              <p>
                Declaro que conferi todas as peças devolvidas referentes à {sep.order_type === 'os' ? 'Ordem de Serviço' : 'Venda'} <strong>#{sep.order_code}</strong> do
                cliente <strong>{sep.client_name}</strong> e que todos os itens estão totalmente conforme foram enviados, sem avarias, faltas ou divergências.
              </p>
              <p>
                Estou ciente de que devo informar imediatamente aos responsáveis sobre esta devolução para a devida tratativa do item, incluindo reposição ao estoque e eventuais providências necessárias.
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={returnTermAccepted}
                onChange={(e) => setReturnTermAccepted(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                Li e aceito o Termo de Recebimento de Devolução acima.
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReturnDialogOpen(false)} disabled={returning}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReturn}
              disabled={returning || !returnMotivo || !returnTermAccepted}
            >
              {returning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Undo2 className="h-3.5 w-3.5 mr-1" />
              )}
              Confirmar Devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
