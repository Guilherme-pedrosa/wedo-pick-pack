export type BudgetKind = 'produto' | 'servico';
export type GeneratedDocumentKind = 'venda' | 'os';
export const BUDGET_GENERATION_VERSION = '2026-09-11-budget-kind-v2';

export const documentKindForBudget = (kind: BudgetKind): GeneratedDocumentKind => kind === 'produto' ? 'venda' : 'os';
export const documentLabelForBudget = (kind?: BudgetKind): string => kind === 'produto' ? 'Venda' : kind === 'servico' ? 'OS' : 'documento';

/** The GC collection defines the budget type. Free service lines never override it. */
export async function readAuthoritativeBudget(
  request: (path: string) => Promise<any>, budgetId: string,
): Promise<{ budget: Record<string, any>; kind: BudgetKind; documentKind: GeneratedDocumentKind }> {
  if (!budgetId) throw new Error('Orçamento não identificado.');
  const full = await request(`/api/orcamentos/${encodeURIComponent(budgetId)}`);
  const budget = full?.data;
  if (!budget || String(budget.id) !== budgetId || !budget.codigo) throw new Error('Não foi possível conferir o orçamento original no GC.');
  const kinds: BudgetKind[] = ['produto', 'servico'];
  const matches = await Promise.all(kinds.map(async kind => {
    const response = await request(`/api/orcamentos_${kind === 'produto' ? 'produtos' : 'servicos'}?codigo=${encodeURIComponent(budget.codigo)}&limite=100&pagina=1`);
    if (!Array.isArray(response?.data) || Number(response.meta?.total_paginas || 0) > 1) {
      throw new Error('Não foi possível confirmar o tipo do orçamento no GC.');
    }
    return response.data.some((row: any) => String(row.id) === budgetId);
  }));
  if (matches.filter(Boolean).length !== 1) throw new Error('Tipo do orçamento não confirmado no GC. A geração foi bloqueada.');
  const kind = kinds[matches.indexOf(true)];
  return { budget, kind, documentKind: documentKindForBudget(kind) };
}
