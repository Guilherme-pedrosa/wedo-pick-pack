import type { QueryClient } from '@tanstack/react-query';
import { OPEN_AGENDA_OS_SITUATIONS } from './agendaControl';
import type { GCOrdemServico } from './types';

type ObservedStatus = { situacao_id: string; nome_situacao: string; fetchedAt: string } | null;

export function mergeSeparationStatuses(previous: Record<string, ObservedStatus>, observed: Record<string, ObservedStatus>, startedAt: number) {
  return { ...previous, ...Object.fromEntries(Object.entries(observed)
    .filter(([id]) => !previous[id] || Date.parse(previous[id].fetchedAt) <= startedAt)) };
}

/** Usa exclusivamente o documento confirmado pelo GET posterior à alteração.
 * Não varre a fila nem permite que uma consulta anterior restaure a situação velha. */
export async function cacheConfirmedAgendaOrder(client: QueryClient, order: GCOrdemServico): Promise<void> {
  const queryKey = ['agenda-open-orders'];
  await client.cancelQueries({ queryKey });
  client.setQueryData<GCOrdemServico[]>(queryKey, (previous) => {
    if (!previous) return previous;
    const isOpen = OPEN_AGENDA_OS_SITUATIONS.some(s => s.id === String(order.situacao_id));
    if (isOpen && !previous.some(row => String(row.id) === String(order.id))) return [order, ...previous];
    return previous.flatMap(row => String(row.id) === String(order.id) ? (isOpen ? [order] : []) : [row]);
  });
}
