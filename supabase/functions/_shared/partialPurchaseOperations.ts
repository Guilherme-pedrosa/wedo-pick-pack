import type { PartialWriteoffOperation } from '../../../src/api/partialWriteoff.ts';

/** A lista de compras não pode omitir uma baixa por limite de página ou erro de leitura. */
export async function readPartialPurchaseOperations(db: any): Promise<PartialWriteoffOperation[]> {
  const all = async (table: string, configure: (query: any) => any) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await configure(db.from(table).select('*')).range(from, from + 999);
      if (error || !Array.isArray(data)) throw new Error('Não foi possível conferir todos os saldos das baixas parciais. A lista anterior foi preservada.');
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  };
  const operations = await all('partial_writeoff_operations', q => q.not('status', 'in', '(completed,cancelled)').order('id'));
  const items: any[] = [], batches: any[] = [];
  for (let start = 0; start < operations.length; start += 100) {
    const ids = operations.slice(start, start + 100).map(o => o.id);
    items.push(...await all('partial_writeoff_item_balances', q => q.in('operation_id', ids).order('id')));
    batches.push(...await all('partial_writeoff_batches', q => q.in('operation_id', ids).order('id')));
  }
  return operations.map(o => ({ ...o, items: items.filter(i => i.operation_id === o.id), batches: batches.filter(b => b.operation_id === o.id) }));
}
