import { supabase } from '@/integrations/supabase/client';
import { getOS, getVenda, getProductStock } from './gestaoclick';
import { assertDefinitiveContents } from './partialConsolidation';
import { assertStockConflict, fetchOsStockCommitments } from './osStockCommitments';
import { mapPool } from '@/lib/mapPool';
import { documentStockLines } from '../../supabase/functions/_shared/osStockCommitments';
import { isCancelledStatus, isExecutedStatus, type GcRecord } from './partialExecution';


/** Consulta fresca antes de iniciar e antes de aplicar a baixa. */
export async function assertCheckoutStock(osId: string, expected?: GcRecord, ownBatchId?: string, type: 'os' | 'venda' = 'os'): Promise<GcRecord> {
  const current = await (type === 'os' ? getOS(osId) : getVenda(osId)) as unknown as GcRecord;
  if (!current || String(current.id) !== osId) throw new Error('Documento inconsistente no GestãoClick. Atualize a fila.');
  if (isCancelledStatus(current.nome_situacao) || isExecutedStatus(current.nome_situacao)) throw new Error('Este documento foi cancelado ou já executado. Atualize a fila antes de conferir.');
  if (expected) assertDefinitiveContents(expected, current);
  const requested = documentStockLines(current);
  if (String(current.situacao_estoque) === '1') return current;
  const reservationsPromise = (async () => {
    const rows: GcRecord[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('partial_writeoff_reservation_sources').select('*').range(from, from + 999);
      if (error) throw new Error('Não foi possível conferir todas as reservas locais.');
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return rows;
  })();
  const ownPromise = (async () => {
    const own = new Map<string, number>();
    if (!ownBatchId) return own;
    const { data, error } = await supabase.from('partial_writeoff_batch_items')
      .select('quantity, partial_writeoff_items(product_id, variation_id)').eq('batch_id', ownBatchId);
    if (error) throw new Error('Não foi possível conferir a reserva deste lote.');
    for (const entry of (data || []) as any[]) {
      const item = entry.partial_writeoff_items;
      const key = `${item.product_id}::${item.variation_id || ''}`;
      own.set(key, (own.get(key) || 0) + Number(entry.quantity));
    }
    return own;
  })();
  const totals = new Map<string, typeof requested[number]>();
  for (const line of requested) {
    const key = `${line.productId}::${line.variationId}`;
    totals.set(key, { ...line, quantity: line.quantity + (totals.get(key)?.quantity || 0) });
  }
  const entries = [...totals];
  const [external, reservations, own, stocks] = await Promise.all([
    fetchOsStockCommitments(),
    reservationsPromise,
    ownPromise,
    mapPool(entries, 5, ([, line]) => getProductStock(line.productId, line.variationId || undefined, { forceFresh: true })),
  ]);
  for (const [index, [key, line]] of entries.entries()) {
    const stock = stocks[index];
    if (!stock) throw new Error(`Saldo indisponível para o produto ${line.productId}.`);
    const reserved = reservations.filter(r => r.product_id === line.productId && (!line.variationId || !r.variation_id || r.variation_id === line.variationId))
      .reduce((n, r) => n + Number(r.reserved_quantity), 0);
    const ownQuantity = line.variationId ? (own.get(key) || 0) : [...own].filter(([k]) => k.startsWith(`${line.productId}::`)).reduce((n, [, q]) => n + q, 0);
    assertStockConflict(stock.estoque, line.quantity, Math.max(0, reserved - ownQuantity), external, line.productId, line.variationId, type === 'os' ? osId : undefined);
  }

  return current;
}
