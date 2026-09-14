import { getOS, getVenda, updateOSStatus, updateVendaStatus } from './gestaoclick';
import { assertSeparationAssignmentCurrent, linkTechnicianToSeparation, type SeparationRecord } from './separations';
import type { Order } from './types';
import { logSystemAction } from '@/lib/systemLog';

/** O recebimento devolve a custódia, preservando a conferência e todas as peças.
 * A movimentação de estoque continua sendo feita apenas pela situação no GC. */
export async function returnSeparationForAgenda(input: {
  separation: SeparationRecord;
  reason: string;
  gcUsuarioId?: string;
  onStatusConfirmed: (order: Order) => void | Promise<void>;
}): Promise<void> {
  const { separation, reason, gcUsuarioId, onStatusConfirmed } = input;
  await assertSeparationAssignmentCurrent(separation);
  const statusId = '7063705';
  const confirmed = separation.order_type === 'os'
    ? await updateOSStatus(separation.order_id, await getOS(separation.order_id), statusId, undefined, gcUsuarioId)
    : await updateVendaStatus(separation.order_id, await getVenda(separation.order_id), statusId, undefined, gcUsuarioId);
  await onStatusConfirmed(confirmed);

  const released = await linkTechnicianToSeparation(separation.id, null, null, undefined, separation.technician_gc_id);
  await logSystemAction({
    module: 'separations', action: 'devolucao_agenda', entityType: separation.order_type,
    entityId: separation.order_id, entityName: `${separation.order_type === 'os' ? 'OS' : 'Venda'} #${separation.order_code}`,
    details: {
      motivo: reason, novo_status_id: confirmed.situacao_id, client_name: separation.client_name,
      separation_id: separation.id, previous_technician_gc_id: separation.technician_gc_id,
      previous_technician_name: separation.technician_name, technician_released: released,
    },
  });
  if (!released) throw new Error('A situação foi confirmada no GC, mas o vínculo mudou ou não pôde ser encerrado. Atualize a tela e confira o responsável pelas peças.');
}
