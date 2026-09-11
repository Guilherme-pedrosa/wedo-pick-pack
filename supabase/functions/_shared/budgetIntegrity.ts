import type { GcRecord } from './partialExecution.ts';

// Somente campos operacionais/gerados pelo GC. Dados comerciais não entram aqui.
const operational = new Set(['situacao_id', 'nome_situacao', 'cor_situacao', 'situacao_estoque',
  'situacao_financeiro', 'modificado_em', 'usuario_id', 'nome_usuario', 'valor_custo']);

function scalar(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text).toString() : text;
}

/** Confere os campos originais; o GC pode acrescentar IDs/metadados na resposta. */
export function documentDifferences(source: GcRecord, actual: GcRecord): string[] {
  const differences: string[] = [];
  const visit = (expected: any, received: any, path: string) => {
    if (Array.isArray(expected)) {
      if (!Array.isArray(received) || expected.length !== received.length) { differences.push(path); return; }
      expected.forEach((v, i) => visit(v, received[i], `${path}[${i}]`));
    } else if (expected && typeof expected === 'object') {
      for (const key of Object.keys(expected)) {
        // IDs das linhas mudam em PUT; produto_id/servico_id/atributo_id permanecem.
        if (operational.has(key) || key.startsWith('_partial_') || (path && key === 'id')) continue;
        visit(expected[key], received?.[key], path ? `${path}.${key}` : key);
      }
    } else if (scalar(expected) !== scalar(received)) differences.push(path);
  };
  visit(source, actual, '');
  return differences;
}

export function assertBudgetUnchanged(reference: GcRecord, actual: GcRecord): void {
  const source = { ...reference, id: reference._partial_source_id || reference.id };
  const differences = documentDifferences(source, actual);
  if (differences.length) throw new Error(`Orçamento alterado desde a referência: ${differences.slice(0, 8).join(', ')}. Ação bloqueada para preservar os dados e as baixas anteriores.`);
}

/** Os saldos locais devem corresponder ao orçamento integral, não só ao lote. */
export function assertOperationQuantities(reference: GcRecord, items: GcRecord[]): void {
  const key = (p: GcRecord) => `${p.produto_id || p.product_id || ''}::${p.variacao_id || p.variation_id || ''}`;
  const requested = new Map<string, number>();
  for (const line of reference.produtos || []) {
    const p = line.produto || line;
    if (String(p.movimenta_estoque) === '0' || !p.produto_id) continue;
    requested.set(key(p), (requested.get(key(p)) || 0) + Number(p.quantidade));
  }
  const recorded = new Map<string, number>();
  for (const item of items) {
    const original = Number(item.original_quantity);
    if (!Number.isFinite(original) || original < Number(item.withdrawn_quantity) + Number(item.reserved_quantity)) {
      throw new Error('Quantidades locais incompatíveis com as baixas e reservas já realizadas.');
    }
    recorded.set(key(item), (recorded.get(key(item)) || 0) + original);
  }
  if (requested.size !== recorded.size || [...requested].some(([k, q]) => !Number.isFinite(q) || !recorded.has(k) || Math.abs(q - recorded.get(k)!) > 0.000001)) {
    throw new Error('As quantidades locais não correspondem ao orçamento integral. Conferência obrigatória antes de movimentar estoque.');
  }
}
