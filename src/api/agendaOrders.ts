import { OPEN_AGENDA_OS_SITUATIONS } from '@/api/agendaControl';
import { listOS } from '@/api/gestaoclick';
import type { GCOrdemServico } from '@/api/types';

const PAGE_SIZE = 100;

async function listSituationOrders(situationId: string): Promise<GCOrdemServico[]> {
  const first = await listOS(situationId, 1, undefined, PAGE_SIZE);
  const rows = [...first.data];
  const totalPages = Math.max(1, Number(first.meta?.total_paginas || 1));

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await listOS(situationId, page, undefined, PAGE_SIZE);
    rows.push(...result.data);
  }

  return rows;
}

/**
 * Carrega o mesmo conjunto de situações abertas do Controle OS diretamente
 * do GestãoClick configurado no Pick & Pack.
 */
export async function getOpenAgendaOrders(): Promise<GCOrdemServico[]> {
  const byId = new Map<string, GCOrdemServico>();
  const situationIds = OPEN_AGENDA_OS_SITUATIONS.map((situation) => situation.id);

  for (let index = 0; index < situationIds.length; index += 3) {
    const batches = await Promise.all(
      situationIds.slice(index, index + 3).map(listSituationOrders),
    );
    for (const orders of batches) {
      for (const order of orders) byId.set(String(order.id), order);
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    String(b.codigo).localeCompare(String(a.codigo), 'pt-BR', { numeric: true }),
  );
}
