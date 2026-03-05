import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTodaySeparations, invalidateSeparation, SeparationRecord } from '@/api/separations';
import { getOS, getVenda } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';

export default function SeparationsPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ checked: 0, total: 0 });

  const { data: separations = [], isLoading, refetch } = useQuery({
    queryKey: ['today-separations'],
    queryFn: getTodaySeparations,
    refetchInterval: 30000,
  });

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

  const todayFormatted = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      {/* Screen-only controls */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-primary" />
            Separações do Dia
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {separations.length} separação(ões) hoje — {validCount} válida(s), {invalidCount} invalidada(s)
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

      {/* Print header - only visible when printing */}
      <div className="hidden print:block print:mb-6">
        <div className="text-center border-b-2 border-foreground pb-3 mb-4">
          <h1 className="text-2xl font-bold">📦 Relatório de Separações</h1>
          <p className="text-sm mt-1">{todayFormatted}</p>
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
          <p className="text-muted-foreground">Nenhuma separação realizada hoje</p>
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
          <SeparationCard key={sep.id} sep={sep} formatTime={formatTime} formatDuration={formatDuration} />
        ))}
      </div>
    </div>
  );
}

function SeparationCard({
  sep,
  formatTime,
  formatDuration,
}: {
  sep: SeparationRecord;
  formatTime: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
}) {
  const isInvalid = sep.invalidated;

  return (
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
        <span className="text-xs text-muted-foreground">
          {formatTime(sep.concluded_at)}
        </span>
      </div>

      <p className="text-sm font-medium text-foreground mb-1">{sep.client_name}</p>

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
    </Card>
  );
}
