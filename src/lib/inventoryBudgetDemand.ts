import type { GCMeta, GCOrcamento, GCOrcamentoProduto } from '@/api/types';

export const INVENTORY_BUDGET_TYPES = ['produto', 'servico'] as const;

export type InventoryBudgetType = (typeof INVENTORY_BUDGET_TYPES)[number];

export interface TypedInventoryBudget {
  budget: GCOrcamento;
  type: InventoryBudgetType;
}

export interface InventoryBudgetDemandRef {
  codigo: string;
  qtd: number;
  cliente: string;
  tipo: InventoryBudgetType;
}

export interface InventoryBudgetDemandEntry {
  qtd: number;
  refs: InventoryBudgetDemandRef[];
  nomeProduto: string | null;
  codigoProduto: string | null;
}

type PartialPendingDemand = Map<string, Map<string, number>>;

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === '0' || normalized === 'null' || normalized === 'undefined') return '';
  return normalized;
}

function parseQuantity(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  if (raw.includes(',') && raw.includes('.')) {
    return Number.parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (raw.includes(',')) return Number.parseFloat(raw.replace(',', '.')) || 0;
  return Number.parseFloat(raw) || 0;
}

/**
 * O GestãoClick pode devolver `data: []` sem `meta` quando não há orçamento.
 * Nessa resposta, comparar a página com `meta.total_paginas` gera um loop sem fim.
 */
export function hasNextBudgetPage(
  page: number,
  rows: unknown[],
  meta?: Partial<GCMeta> & { proxima_pagina?: number | string | null },
): boolean {
  if (rows.length === 0) return false;

  const totalPages = Number(meta?.total_paginas);
  if (Number.isFinite(totalPages) && totalPages > 0) return page < totalPages;

  const nextPage = Number(meta?.proxima_pagina);
  return Number.isFinite(nextPage) && nextPage > page;
}

/**
 * Soma somente peças/produtos dos dois tipos de orçamento do GC. Linhas de
 * serviço não são estoque, mas um orçamento do tipo `servico` pode conter as
 * peças necessárias para a execução e elas precisam entrar na demanda.
 */
export function aggregateInventoryBudgetDemand(
  typedBudgets: TypedInventoryBudget[],
  partialPendingByBudgetAndProduct: PartialPendingDemand = new Map(),
): Map<string, InventoryBudgetDemandEntry> {
  const result = new Map<string, InventoryBudgetDemandEntry>();
  const uniqueBudgets = new Map<string, TypedInventoryBudget>();

  for (const entry of typedBudgets) {
    const budgetId = normalizeId(entry.budget?.id);
    if (!budgetId || uniqueBudgets.has(budgetId)) continue;
    uniqueBudgets.set(budgetId, entry);
  }

  for (const { budget, type } of uniqueBudgets.values()) {
    const budgetId = normalizeId(budget.id);
    const partialPending = partialPendingByBudgetAndProduct.get(budgetId);
    const processedPartialKeys = new Set<string>();

    for (const wrapper of budget.produtos || []) {
      const normalizedWrapper = wrapper as unknown as { produto?: GCOrcamentoProduto };
      const product = normalizedWrapper.produto ?? (wrapper as unknown as GCOrcamentoProduto);
      const productId = normalizeId(product?.produto_id);
      if (!productId) continue;

      const variationId = normalizeId(product?.variacao_id ?? product?.estoque_id);
      const productKey = variationId ? `${productId}::${variationId}` : productId;
      let quantity = parseQuantity(product?.quantidade);

      // Em baixa parcial, o Pick & Pack é a fonte do saldo ainda pendente.
      if (partialPending) {
        if (processedPartialKeys.has(productKey)) continue;
        processedPartialKeys.add(productKey);
        quantity = partialPending.get(productKey) ?? partialPending.get(productId) ?? 0;
      }

      if (quantity <= 0) continue;

      if (!result.has(productId)) {
        result.set(productId, {
          qtd: 0,
          refs: [],
          nomeProduto: String(product?.nome_produto ?? '').trim() || null,
          codigoProduto: String(product?.codigo_produto ?? '').trim() || null,
        });
      }
      const demand = result.get(productId)!;
      if (!demand.nomeProduto) demand.nomeProduto = String(product?.nome_produto ?? '').trim() || null;
      if (!demand.codigoProduto) demand.codigoProduto = String(product?.codigo_produto ?? '').trim() || null;
      demand.qtd += quantity;
      demand.refs.push({
        codigo: String(budget.codigo ?? ''),
        qtd: quantity,
        cliente: String(budget.nome_cliente ?? ''),
        tipo: type,
      });
    }
  }

  return result;
}
