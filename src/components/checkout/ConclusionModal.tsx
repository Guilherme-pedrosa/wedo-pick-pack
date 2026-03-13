import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCheckoutStore } from '@/store/checkoutStore';
import { getStatusOS, getStatusVendas, updateOSStatus, updateVendaStatus } from '@/api/gestaoclick';
import { GCOrdemServico, GCVenda } from '@/api/types';
import { createSeparation } from '@/api/separations';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  forced?: boolean;
}

export default function ConclusionModal({ open, onClose, forced }: Props) {
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

  // Sync selectedStatus with config default
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

      // Find target status name
      const targetStatusName = statusQuery.data?.find(s => s.id === effectiveStatus)?.nome || '';

      // Save separation record to DB
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
      });

      concludeSession();
      queryClient.invalidateQueries({ queryKey: ['today-separations'] });
      toast.success('✓ Separação concluída! Status atualizado no GestãoClick.');
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !effectiveStatus}
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
