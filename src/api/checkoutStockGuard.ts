import { supabase } from '@/integrations/supabase/client';
import { getOS, getProductStock } from './gestaoclick';
import { assertDefinitiveContents } from './partialConsolidation';
import { assertStockConflict, fetchOsStockCommitments, pendingOsLines } from './osStockCommitments';
import { isCancelledStatus, isExecutedStatus, type GcRecord } from './partialExecution';

/** Consulta fresca antes de iniciar e antes de aplicar a baixa. */
export async function assertCheckoutStock(osId: string, expected?: GcRecord, ownBatchId?: string): Promise<GcRecord> {
  const current = await getOS(osId) as unknown as GcRecord;
  if (isCancelledStatus(current.nome_situacao) || isExecutedStatus(current.nome_situacao)) throw new Error('Esta OS foi cancelada ou já executada. Atualize a fila antes de conferir.');
  if (expected) assertDefinitiveContents(expected, current);
  const requested = pendingOsLines(current);
  if (String(current.situacao_estoque) === '1') return current;
  const external = await fetchOsStockCommitments();
  const reservations: GcRecord[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('partial_writeoff_reservation_sources').select('*').range(from, from + 999);
    if (error) throw new Error('Não foi possível conferir todas as reservas locais.');
    reservations.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const own = new Map<string, number>();
  if (ownBatchId) {
    const { data, error } = await supabase.from('partial_writeoff_batch_items')
      .select('quantity, partial_writeoff_items(product_id, variation_id)').eq('batch_id', ownBatchId);
    if (error) throw new Error('Não foi possível conferir a reserva deste lote.');
    for (const entry of (data || []) as any[]) {
      const item = entry.partial_writeoff_items;
      const key = `${item.product_id}::${item.variation_id || ''}`;
      own.set(key, (own.get(key) || 0) + Number(entry.quantity));
    }
  }
  const totals = new Map<string, typeof requested[number]>();
  for (const line of requested) {
    const key = `${line.productId}::${line.variationId}`;
    totals.set(key, { ...line, quantity: line.quantity + (totals.get(key)?.quantity || 0) });
  }
  for (const [key, line] of totals) {
    const stock = await getProductStock(line.productId, line.variationId || undefined, { forceFresh: true });
    if (!stock) throw new Error(`Saldo indisponível para o produto ${line.productId}.`);
    const reserved = reservations.filter(r => r.product_id === line.productId && (!line.variationId || !r.variation_id || r.variation_id === line.variationId))
      .reduce((n, r) => n + Number(r.reserved_quantity), 0);
    const ownQuantity = line.variationId ? (own.get(key) || 0) : [...own].filter(([k]) => k.startsWith(`${line.productId}::`)).reduce((n, [, q]) => n + q, 0);
    assertStockConflict(stock.estoque, line.quantity, Math.max(0, reserved - ownQuantity), external, line.productId, line.variationId, osId);
  }
  return current;
}
