import { purchaseSnapshotStale } from './purchaseFreshness.ts';

type PurchaseSnapshot = {
  id: string; created_at: string; total_produtos_sem_estoque: number;
  total_itens_cobertos_pedido: number; total_orcamentos: number; duration_ms: number;
};

/** Disponibilidade do resultado não significa que uma nova execução foi feita. */
export function purchaseScanStatus(snapshot: PurchaseSnapshot | null, now = Date.now()) {
  const state = !snapshot ? 'missing' : purchaseSnapshotStale(snapshot.created_at, now) ? 'stale' : 'current';
  return {
    version: '2026-09-14-snapshot-status-v1', mode: 'snapshot_status', runner: 'github_actions',
    legacy_scan_retired: true, scan_started: false, state,
    last_success_at: snapshot?.created_at ?? null, snapshot_id: snapshot?.id ?? null,
    total_itens_comprar: snapshot?.total_produtos_sem_estoque ?? null,
    total_itens_cobertos_pedido: snapshot?.total_itens_cobertos_pedido ?? null,
    total_orcamentos: snapshot?.total_orcamentos ?? null, duration_ms: snapshot?.duration_ms ?? null,
    message: state === 'missing' ? 'Ainda não há varredura de compras concluída. Nenhum resultado está confirmado.'
      : state === 'stale' ? 'A última lista de compras está desatualizada. A rotina automática do GitHub precisa concluir uma nova varredura; Compras também permite atualizar a lista na tela.'
      : 'Resultado da última varredura concluída. A execução automática ocorre no GitHub; esta consulta não iniciou outra varredura.',
  };
}
