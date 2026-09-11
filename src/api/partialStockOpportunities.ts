import { supabase } from '@/integrations/supabase/client';
import { assertBudgetUnchanged, assertOperationQuantities } from './budgetIntegrity';
import { commitmentFor, fetchOsStockCommitments, type OsStockCommitment } from './osStockCommitments';
import type { GcRecord } from './partialExecution';
import type { PartialWriteoffOperation, PartialWriteoffItem } from './partialWriteoff';

const reservable = new Set(['awaiting_separation', 'partial_separation', 'awaiting_balance']);
const pending = (i: PartialWriteoffItem) => Number(i.original_quantity) - Number(i.withdrawn_quantity) - Number(i.reserved_quantity);
const variation = (i: PartialWriteoffItem) => String((i.line_snapshot as GcRecord)?.produto?.possui_variacao) === '1' ? i.variation_id : '';
const key = (i: PartialWriteoffItem) => `${i.product_id}::${variation(i)}`;
const qty = (v: number) => Number(v.toFixed(6));

export interface PartialStockOpportunity {
  operationId: string; budgetCode: string; clientName: string; sourceKind: 'venda' | 'orcamento';
  itemId: string; productId: string; variationId: string; productName: string; productCode: string; unit: string;
  pendingQuantity: number; stockQuantity: number; committedQuantity: number; availableQuantity: number;
  suggestedQuantity: number; allocatedEarlier: number;
}
export interface PartialStockScan {
  startedAt: string; checkedAt: string; operationsChecked: number; pendingOperations: number;
  opportunities: PartialStockOpportunity[];
  issues: Array<{ operationId: string; budgetCode: string; message: string }>;
}
export interface PartialStockPorts {
  operations(): Promise<PartialWriteoffOperation[]>;
  commitments(): Promise<OsStockCommitment[]>;
  gc(path: string): Promise<GcRecord>;
}

/** Só GET no GC e SELECT no banco: uma recomendação nunca cria reserva ou baixa. */
async function readGc(path: string): Promise<GcRecord> {
  const { data, error } = await supabase.functions.invoke('gc-proxy', { body: { path, method: 'GET' } });
  if (error || !data?._proxy?.ok) throw new Error('Consulta ao GestãoClick indisponível.');
  return data;
}

async function allRows(table: string, configure: (query: any) => any): Promise<GcRecord[]> {
  const rows: GcRecord[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await configure((supabase as any).from(table).select('*')).range(from, from + 999);
    if (error || !Array.isArray(data)) throw new Error('Não foi possível consultar todas as baixas parciais.');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function readOpenPartialOperations(): Promise<PartialWriteoffOperation[]> {
  const operations = await allRows('partial_writeoff_operations', q => q.not('status', 'in', '(completed,cancelled)').order('id'));
  if (!operations.length) return [];
  const ids = operations.map(o => o.id);
  const items: GcRecord[] = [];
  // Limita o tamanho do filtro HTTP, sem limitar quantas operações entram na varredura.
  for (let start = 0; start < ids.length; start += 100) {
    items.push(...await allRows('partial_writeoff_item_balances', q => q.in('operation_id', ids.slice(start, start + 100)).order('id')));
  }
  return operations.map(o => ({ ...o, batches: [], items: items.filter(i => i.operation_id === o.id) })) as PartialWriteoffOperation[];
}

export function strictProductStock(response: GcRecord, productId: string, variationId: string): { stock: number; code: string } {
  const detail = response.data?.Produto || response.data?.produto || response.data;
  if (!detail || String(detail.id) !== productId) throw new Error('Produto não confirmado no GC.');
  let raw = detail.estoque;
  if (variationId) {
    const match = (detail.variacoes || []).map((v: GcRecord) => v.variacao || v).find((v: GcRecord) =>
      [v.id, v.variacao_id, v.variacao_api_id].some(id => String(id ?? '') === variationId));
    if (!match) throw new Error('Estoque da variação não confirmado no GC.');
    raw = match.estoque;
  }
  const value = raw == null || String(raw).trim() === '' ? NaN : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) throw new Error('Estoque não informado pelo GC.');
  return { stock: Math.max(0, value), code: String(detail.codigo_interno || '') };
}

function fingerprint(operations: PartialWriteoffOperation[]): string {
  return JSON.stringify(operations.filter(o => o.items.some(i => pending(i) > 0 || Number(i.reserved_quantity) > 0))
    .map(o => [o.id, o.version, o.status, o.items.map(i => [i.id, i.original_quantity, i.withdrawn_quantity, i.reserved_quantity]).sort()]).sort());
}

export async function scanPartialStock(ports: PartialStockPorts): Promise<PartialStockScan> {
  const startedAt = new Date().toISOString();
  const operations = await ports.operations();
  const candidates = operations.filter(o => o.items.some(i => pending(i) > 0));
  const result: PartialStockScan = { startedAt, checkedAt: startedAt, operationsChecked: operations.length,
    pendingOperations: candidates.length, opportunities: [], issues: [] };
  if (!candidates.length) return result;
  // A consulta global deve terminar por inteiro; uma falha não vira estoque livre.
  const commitments = await ports.commitments();
  const validated: PartialWriteoffOperation[] = [];
  for (const operation of candidates) {
    if (!reservable.has(operation.status)) {
      result.issues.push({ operationId: operation.id, budgetCode: operation.budget_code, message: 'Esta baixa precisa de reconciliação antes de reservar novas peças.' });
      continue;
    }
    try {
      const source = operation.budget_snapshot;
      const sale = source._partial_source_kind === 'venda';
      const sourceId = String(source._partial_source_id || operation.budget_id);
      const current = (await ports.gc(`/api/${sale ? 'vendas' : 'orcamentos'}/${encodeURIComponent(sourceId)}`)).data;
      if (!current || String(current.id) !== sourceId) throw new Error('Documento de origem não confirmado no GC.');
      if (sale && String(current.situacao_estoque) !== '0') throw new Error('A venda original já movimentou estoque.');
      if (!sale && /\b(os|venda)\b.*gerad[ao]|cancelad[ao]/i.test(String(current.nome_situacao || ''))) throw new Error('O orçamento já foi convertido ou cancelado.');
      assertBudgetUnchanged(source, current);
      assertOperationQuantities(source, operation.items);
      validated.push(operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível validar o orçamento.';
      result.issues.push({ operationId: operation.id, budgetCode: operation.budget_code,
        message: /referência|quantidades locais/i.test(message) ? 'O orçamento atual diverge da referência da baixa. Confira os dados antes de continuar.' : message });
    }
  }

  const stockResponses = new Map<string, Promise<GcRecord>>();
  const allocated = new Map<string, number>();
  // Uma peça compartilhada só aparece uma vez na sugestão total; prioridade por abertura.
  validated.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const operation of validated) for (const item of operation.items.filter(i => pending(i) > 0).sort((a, b) => a.id.localeCompare(b.id))) {
    try {
      const variationId = variation(item);
      if (String((item.line_snapshot as GcRecord)?.produto?.possui_variacao) === '1' && !variationId) throw new Error('Variação do item não identificada.');
      if (!stockResponses.has(item.product_id)) stockResponses.set(item.product_id, ports.gc(`/api/produtos/${encodeURIComponent(item.product_id)}?cache_bust=${Date.now()}`));
      const { stock, code } = strictProductStock(await stockResponses.get(item.product_id)!, item.product_id, variationId);
      const localReserved = operations.flatMap(o => o.items).filter(i => key(i) === key(item)).reduce((n, i) => n + Number(i.reserved_quantity), 0);
      const external = commitmentFor(commitments, item.product_id, variationId).outstanding;
      const available = Math.max(0, stock - localReserved - external);
      const prior = allocated.get(key(item)) || 0;
      const suggested = qty(Math.min(pending(item), Math.max(0, available - prior)));
      if (suggested <= 0) continue;
      allocated.set(key(item), qty(prior + suggested));
      result.opportunities.push({ operationId: operation.id, budgetCode: operation.budget_code, clientName: operation.client_name,
        sourceKind: operation.budget_snapshot._partial_source_kind === 'venda' ? 'venda' : 'orcamento',
        itemId: item.id, productId: item.product_id, variationId, productName: item.product_name,
        productCode: item.product_code || code, unit: item.unit, pendingQuantity: qty(pending(item)), stockQuantity: stock,
        committedQuantity: qty(localReserved + external), availableQuantity: qty(available), suggestedQuantity: suggested, allocatedEarlier: prior });
    } catch (error) {
      result.issues.push({ operationId: operation.id, budgetCode: operation.budget_code,
        message: `${item.product_name}: ${error instanceof Error ? error.message : 'Não foi possível consultar o estoque.'}` });
    }
  }
  if (fingerprint(operations) !== fingerprint(await ports.operations())) throw new Error('As baixas mudaram durante a varredura. Atualize para conferir as quantidades novamente.');
  result.checkedAt = new Date().toISOString();
  return result;
}

export function getPartialStockOpportunities(commitments = fetchOsStockCommitments): Promise<PartialStockScan> {
  return scanPartialStock({ operations: readOpenPartialOperations, commitments, gc: readGc });
}
