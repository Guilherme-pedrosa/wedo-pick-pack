import type { PartialWriteoffOperation } from '../../../src/api/partialWriteoff.ts';
import type { GcRecord } from './partialExecution.ts';
const unwrap = (p: GcRecord) => p.produto || p;
const number = (v: unknown) => Number(String(v ?? '').includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);
const key = (p: GcRecord) => `${p.produto_id}::${String(p.possui_variacao) === '0' ? '' : p.variacao_id || ''}`;

/** A necessidade vem do GC atual; baixas e reservas são fatos locais preservados. */
export function currentPartialDemand(operation: PartialWriteoffOperation, source: GcRecord) {
  if (!Array.isArray(source.produtos)) throw new Error(`Itens atuais da origem #${operation.budget_code} não informados.`);
  const totals = new Map<string, { raw: GcRecord; requested: number; withdrawn: number; reserved: number; previous: number }>();
  for (const wrapper of source.produtos) {
    const raw = unwrap(wrapper), quantity = number(raw.quantidade);
    if (String(raw.movimenta_estoque) === '0' || !raw.produto_id) continue;
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Quantidade inválida na origem #${operation.budget_code}.`);
    const k = key(raw), value = totals.get(k) || { raw, requested: 0, withdrawn: 0, reserved: 0, previous: 0 };
    value.requested += quantity; totals.set(k, value);
  }
  for (const item of operation.items) {
    const raw = { ...unwrap((item.line_snapshot || {}) as GcRecord), produto_id: item.product_id, variacao_id: item.variation_id };
    const k = key(raw), value = totals.get(k) || { raw, requested: 0, withdrawn: 0, reserved: 0, previous: 0 };
    const quantities = [item.original_quantity, item.withdrawn_quantity, item.reserved_quantity].map(number);
    if (quantities.some(n => !Number.isFinite(n) || n < 0) || quantities[1] + quantities[2] > quantities[0] + 0.000001) throw new Error(`Saldo inconsistente na baixa #${operation.budget_code}.`);
    value.previous += quantities[0]; value.withdrawn += quantities[1]; value.reserved += quantities[2]; totals.set(k, value);
  }
  return [...totals.values()].map(value => {
    if (value.withdrawn + value.reserved > value.requested + 0.000001) throw new Error(`Orçamento #${operation.budget_code} foi reduzido abaixo do que já foi retirado/reservado. Reconcilie a origem antes de atualizar compras.`);
    return { ...value, pending: Number(Math.max(0, value.requested - value.withdrawn - value.reserved).toFixed(6)),
      changed: Math.abs(value.previous - value.requested) > 0.000001 };
  });
}
