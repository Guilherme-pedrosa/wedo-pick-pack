type PartialWriteoffOperationSource = {
  budget_id?: unknown;
  budget_snapshot?: Record<string, unknown> | null;
  status?: unknown;
};

const INACTIVE_STATUSES = new Set(['completed', 'cancelled']);

function normalizedDocumentKind(value: unknown): 'venda' | 'os' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'venda' || normalized === 'os' ? normalized : null;
}

/**
 * Retorna a chave do documento-fonte que nao pode ser contado integralmente
 * enquanto sua baixa parcial estiver ativa. O saldo confirmado dos batches e
 * a fonte oficial durante esse periodo.
 */
export function activePartialWriteoffSourceKey(
  operation: PartialWriteoffOperationSource,
): string | null {
  const status = String(operation.status ?? '').trim().toLowerCase();
  if (INACTIVE_STATUSES.has(status)) return null;

  const budgetId = String(operation.budget_id ?? '').trim();
  const direct = budgetId.match(/^(venda|os):(.+)$/i);
  if (direct) return `${direct[1].toLowerCase()}:${direct[2].trim()}`;

  const snapshot = operation.budget_snapshot ?? {};
  const kind = normalizedDocumentKind(snapshot._partial_source_kind);
  const sourceId = String(snapshot._partial_source_id ?? '').trim();
  return kind && sourceId ? `${kind}:${sourceId}` : null;
}

export function activePartialWriteoffSourceIds(
  operations: PartialWriteoffOperationSource[],
  documentKind: 'venda' | 'os',
): Set<string> {
  const prefix = `${documentKind}:`;
  const result = new Set<string>();

  for (const operation of operations) {
    const key = activePartialWriteoffSourceKey(operation);
    if (key?.startsWith(prefix)) result.add(key.slice(prefix.length));
  }

  return result;
}
