import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), in: vi.fn(), not: vi.fn(), range: vi.fn(), results: [] as any[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.from } }));
import { getPartialCheckoutQueue } from './partialWriteoff';
const batch = { id: 'b', operation_id: 'op', marker: 'marker', auxiliary_document_type: 'os', auxiliary_document_id: 'gc',
  auxiliary_document_code: '10226', created_at: '2026-09-14', partial_writeoff_operations: { budget_code: '6438', client_name: 'Cliente', status: 'waiting' } };
beforeEach(() => {
  vi.clearAllMocks(); m.results = [];
  const query: any = { select: (...args: any[]) => { m.select(...args); return query; },
    in: (...args: any[]) => { m.in(...args); return query; }, not: (...args: any[]) => { m.not(...args); return query; }, order: () => query,
    range: (...args: any[]) => { m.range(...args); return Promise.resolve(m.results.shift()); } };
  m.from.mockReturnValue(query);
});
it('carrega somente o resumo de lotes pendentes sem baixar snapshots e saldos de todas as operações', async () => {
  m.results.push({ data: [batch], error: null });
  expect(await getPartialCheckoutQueue()).toEqual([{ batchId: 'b', operationId: 'op', marker: 'marker', type: 'os', documentId: 'gc',
    documentCode: '10226', budgetCode: '6438', clientName: 'Cliente', createdAt: '2026-09-14' }]);
  expect(m.from).toHaveBeenCalledExactlyOnceWith('partial_writeoff_batches');
  expect(m.select.mock.calls[0][0]).not.toContain('*');
  expect(m.in).toHaveBeenCalledWith('status', ['awaiting_checkout', 'reconciliation_required']);
  expect(m.not).toHaveBeenCalledWith('partial_writeoff_operations.status', 'in', '(completed,cancelled,consolidating)');
});
it('não oculta erro como fila vazia', async () => {
  m.results.push({ data: null, error: { message: 'indisponível' } });
  await expect(getPartialCheckoutQueue()).rejects.toThrow('indisponível');
});
it('pagina lotes sem cortar silenciosamente a fila', async () => {
  m.results.push({ data: Array.from({ length: 500 }, (_, i) => ({ ...batch, id: String(i) })), error: null },
    { data: [{ ...batch, id: 'last' }], error: null });
  const rows = await getPartialCheckoutQueue();
  expect(rows).toHaveLength(501); expect(rows.at(-1)?.batchId).toBe('last');
  expect(m.range.mock.calls).toEqual([[0, 499], [500, 999]]);
});
