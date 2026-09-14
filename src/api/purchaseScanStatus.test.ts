import { describe, expect, it } from 'vitest';
import { purchaseScanStatus } from '../../supabase/functions/_shared/purchaseScanStatus';

describe('consulta do resultado da rotina de compras', () => {
  const now = Date.parse('2026-09-14T10:00:00Z');
  const snapshot = { id: 'snapshot', created_at: '2026-09-14T09:00:00Z', total_produtos_sem_estoque: 26,
    total_itens_cobertos_pedido: 27, total_orcamentos: 24, duration_ms: 210000 };
  it('diferencia consulta de resultado e execução nova', () => {
    expect(purchaseScanStatus(snapshot, now)).toMatchObject({ state: 'current', scan_started: false,
      last_success_at: snapshot.created_at, total_itens_comprar: 26, runner: 'github_actions' });
  });
  it('expõe dados antigos como desatualizados, preservando a data e as contagens', () => {
    expect(purchaseScanStatus({ ...snapshot, created_at: '2026-09-14T05:00:00Z' }, now)).toMatchObject({
      state: 'stale', scan_started: false, last_success_at: '2026-09-14T05:00:00Z', total_itens_comprar: 26 });
  });
  it('não transforma ausência de resultado em lista vazia confirmada', () => {
    expect(purchaseScanStatus(null, now)).toMatchObject({ state: 'missing', last_success_at: null,
      snapshot_id: null, total_itens_comprar: null, scan_started: false });
    expect(purchaseScanStatus({ ...snapshot, total_produtos_sem_estoque: 0 }, now)).toMatchObject({
      state: 'current', total_itens_comprar: 0 });
  });
});
