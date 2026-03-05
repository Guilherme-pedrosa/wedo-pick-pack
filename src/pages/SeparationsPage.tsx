import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTodaySeparations, invalidateSeparation, SeparationRecord } from '@/api/separations';
import { getOS, getVenda } from '@/api/gestaoclick';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Loader2 } from 'lucide-react';
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

  const validCount = separations.filter(s => !s.invalidated).length;
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

        // If the current status in GC is NOT the target status we set, it was reverted
        if (order.situacao_id !== sep.target_status_id) {
          const reason = `Status alterado no GC: "${order.nome_situacao}" (era "${sep.target_status_name}")`;
          await invalidateSeparation(sep.id, reason);
          invalidated++;
        }
      } catch (err) {
        console.error(`Error checking order ${sep.order_code}:`, err);
      }

      setSyncProgress({ checked: i + 1, total: active.length });

      // Rate limit: wait between requests
      if (i < active.length - 1) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    await refetch();
    setSyncing(false);

    // Also invalidate the separated IDs cache used by OrderQueue
    queryClient.invalidateQueries({ queryKey: ['valid-separated-ids'] });

    if (invalidated > 0) {
      toast.warning(`${invalidated} separação(ões) invalidada(s) por mudança de status no GC`);
    } else {
      toast.success('Todas as separações estão válidas!');
    }
  }, [separations, refetch, queryClient]);

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

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
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
        </div>
      </div>

      {syncing && (
        <div className="space-y-1">
          <Progress value={syncProgress.total > 0 ? (syncProgress.checked / syncProgress.total) * 100 : 0} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Verificando {syncProgress.checked}/{syncProgress.total} separações no GestãoClick…
          </p>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-muted-foreground py-12">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Carregando separações…
        </div>
      )}

      {!isLoading && separations.length === 0 && (
        <Card className="p-8 text-center">
          <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">Nenhuma separação realizada hoje</p>
        </Card>
      )}

      <div className="space-y-3">
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
