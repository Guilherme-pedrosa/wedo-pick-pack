import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCheckoutStore } from '@/store/checkoutStore';
import { getStatusOS, getStatusVendas, updateOSStatus, updateVendaStatus } from '@/api/gestaoclick';
import { GCOrdemServico, GCVenda, PickingItem } from '@/api/types';
import { createSeparation } from '@/api/separations';
import { logSystemAction } from '@/lib/systemLog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface ReceiptData {
  orderType: 'os' | 'venda';
  orderCode: string;
  clientName: string;
  operatorName: string;
  items: PickingItem[];
  startedAt: string;
  concludedAt: string;
  observations: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  forced?: boolean;
  onConcluded?: (data: ReceiptData) => void;
}

export default function ConclusionModal({ open, onClose, forced, onConcluded }: Props) {
  const session = useCheckoutStore(s => s.session);
  const config = useCheckoutStore(s => s.config);
  const concludeSession = useCheckoutStore(s => s.concludeSession);
  const queryClient = useQueryClient();

  const defaultStatus = session?.tipo === 'os'
    ? config.defaultOSConclusionStatus
    : config.defaultVendaConclusionStatus;

  const hasDefault = !!defaultStatus;
  const [selectedStatus, setSelectedStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [observations, setObservations] = useState('');
  const [acceptedTerm, setAcceptedTerm] = useState(false);

  const effectiveStatus = hasDefault ? defaultStatus : selectedStatus;

  const statusQuery = useQuery({
    queryKey: ['statuses-conclusion', session?.tipo],
    queryFn: () => session?.tipo === 'os' ? getStatusOS() : getStatusVendas(),
    enabled: open,
  });

  const configuredStatusName = statusQuery.data?.find(s => s.id === defaultStatus)?.nome || (hasDefault ? `Status #${defaultStatus}` : '');

  if (!session) return null;

  const confirmedCount = session.items.filter(i => i.conferido).length;
  const totalCount = session.items.length;
  const unconfirmed = totalCount - confirmedCount;

  const elapsed = () => {
    const start = new Date(session.startedAt).getTime();
    const now = Date.now();
    const diff = Math.floor((now - start) / 1000);
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return `${min} min ${sec} seg`;
  };

  const handleConfirm = async () => {
    if (!effectiveStatus) {
      toast.error('Selecione um status');
      return;
    }
    setSubmitting(true);
    try {
      if (session.tipo === 'os') {
        await updateOSStatus(session.refId, session.rawOrder as GCOrdemServico, effectiveStatus, config.operatorName, config.gcUsuarioId);
      } else {
        await updateVendaStatus(session.refId, session.rawOrder as GCVenda, effectiveStatus, config.operatorName, config.gcUsuarioId);
      }

      const targetStatusName = statusQuery.data?.find(s => s.id === effectiveStatus)?.nome || '';
      const concludedAt = new Date().toISOString();

      await createSeparation({
        order_type: session.tipo,
        order_id: session.refId,
        order_code: session.codigo,
        client_name: session.nomeCliente,
        status_name: session.nomeSituacao,
        status_id: session.situacaoId,
        target_status_id: effectiveStatus,
        target_status_name: targetStatusName,
        total_value: session.valorTotal,
        items_total: session.items.length,
        items_confirmed: session.items.filter(i => i.conferido).length,
        operator_name: config.operatorName,
        started_at: session.startedAt,
        observations: observations.trim() || undefined,
      });

      const startMs = new Date(session.startedAt).getTime();
      const endMs = new Date(concludedAt).getTime();
      const diffMs = endMs - startMs;
      const durationMins = Math.floor(diffMs / 60000);
      const durationSecs = Math.floor((diffMs % 60000) / 1000);

      const receiptData: ReceiptData = {
        orderType: session.tipo,
        orderCode: session.codigo,
        clientName: session.nomeCliente,
        operatorName: config.operatorName,
        items: [...session.items],
        startedAt: session.startedAt,
        concludedAt,
        observations: observations.trim(),
      };

      logSystemAction({
        module: "checkout",
        action: "Separação concluída",
        entityType: session.tipo === 'os' ? 'OS' : 'Venda',
        entityId: session.refId,
        entityName: `#${session.codigo} - ${session.nomeCliente}`,
        details: {
          items_total: session.items.length,
          items_confirmed: session.items.filter(i => i.conferido).length,
          items: session.items.map(i => ({
            codigo: i.codigo_produto,
            nome: i.nome_produto,
            qtd_esperada: i.qtd_total,
            qtd_conferida: i.qtd_conferida,
            conferido: i.conferido,
          })),
          operator: config.operatorName,
          started_at: session.startedAt,
          concluded_at: concludedAt,
          duration: `${durationMins}min ${durationSecs}s`,
          target_status: targetStatusName,
          observations: observations.trim() || null,
        },
      });

      concludeSession();
      queryClient.invalidateQueries({ queryKey: ['separations'] });
      toast.success('✓ Separação concluída! Status atualizado no GestãoClick.');

      // Notify parent to show receipt
      onConcluded?.(receiptData);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      if (msg === 'RATE_LIMIT') {
        toast.warning('⏳ Limite da API atingido. Tente novamente em 30s.');
      } else if (msg === 'AUTH_ERROR') {
        toast.error('🔑 Credenciais inválidas. Verifique em Configurações.');
      } else if (msg === 'STATUS_NOT_APPLIED') {
        toast.error('⚠️ O GestãoClick não confirmou a troca de status. A separação não foi finalizada.');
      } else if (msg === 'AUTH_REQUIRED') {
        toast.error('🔒 Sessão expirada. Faça login novamente para concluir a separação.');
      } else if (msg === 'SEPARATION_SAVE_FAILED') {
        toast.error('💾 Falha ao registrar a separação no histórico. Nada foi finalizado localmente.');
      } else {
        toast.error(`Erro ao atualizar GestãoClick: ${msg}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar Conclusão da Separação</DialogTitle>
        </DialogHeader>

        <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge className={session.tipo === 'os' ? 'bg-primary text-primary-foreground' : 'bg-purple-700 text-primary-foreground'}>
              {session.tipo === 'os' ? 'OS' : 'VENDA'}
            </Badge>
            <span className="font-semibold">#{session.codigo}</span>
            <span>·</span>
            <span>{session.nomeCliente}</span>
          </div>
          <p>Itens conferidos: <strong>{confirmedCount} de {totalCount}</strong></p>
          <p>Tempo de separação: <strong>{elapsed()}</strong></p>
          {forced && unconfirmed > 0 && (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded p-2 mt-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">⚠️ {unconfirmed} item(ns) não foram conferidos</span>
            </div>
          )}
        </div>

        {defaultStatus ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Novo status no GestãoClick:</label>
            <div className="bg-muted rounded-md px-3 py-2 text-sm font-medium">
              {configuredStatusName}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium">Novo status no GestãoClick:</label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o status" />
              </SelectTrigger>
              <SelectContent>
                {(statusQuery.data || []).map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">Observações da separação (opcional):</label>
          <Textarea
            value={observations}
            onChange={e => setObservations(e.target.value)}
            placeholder="Ex: peça X substituída por Y, cliente retirou pessoalmente..."
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        <div className="border rounded-md p-3 space-y-2 bg-amber-50/50 border-amber-200">
          <p className="text-xs font-semibold text-foreground">TERMO DE RESPONSABILIDADE</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Declaro que realizei a separação das peças desta ordem após conferência do código e da quantidade de cada item. Estou ciente de que divergências decorrentes de falta de atenção (peça incorreta, código divergente, quantidade errada ou ausência de item) serão de minha responsabilidade, sujeitando-me às medidas internas cabíveis.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="accept-term"
              checked={acceptedTerm}
              onCheckedChange={(v) => setAcceptedTerm(v === true)}
            />
            <label htmlFor="accept-term" className="text-xs font-medium cursor-pointer select-none">
              Estou ciente e de acordo
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !effectiveStatus || !acceptedTerm}
            className="bg-success text-success-foreground hover:bg-success/90"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            ✓ Confirmar e Atualizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
