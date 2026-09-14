export type PartialWriteoffBalanceRow = {
  operation_id: string;
  line_key: string;
  product_id: string;
  variation_id: string | null;
  product_name: string;
  product_code: string;
  unit: string;
  original_quantity: number | string | null;
  withdrawn_quantity: number | string | null;
  pending_purchase_quantity: number | string | null;
};

/** Saldo material continua consultável depois da retirada e da execução. */
export const PARTIAL_BALANCE_OPERATION_STATUSES = [
  "awaiting_separation",
  "partial_separation",
  "awaiting_balance",
  "awaiting_execution",
  "ready_to_consolidate",
  "consolidating",
  "completed",
  "reconciliation_required",
];

export type PartialBalanceOperation = {
  id: string;
  budget_id: string;
  budget_code: string;
  status: string;
  updated_at: string;
};

export function newestBalanceOperationByBudget(operations: PartialBalanceOperation[]): PartialBalanceOperation[] {
  const sorted = [...operations]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  return sorted.filter(operation => {
    const id = normalizeBudgetReference(operation.budget_id);
    const code = normalizeBudgetReference(operation.budget_code);
    if ((id && seenIds.has(id)) || (code && seenCodes.has(code))) return false;
    if (id) seenIds.add(id);
    if (code) seenCodes.add(code);
    // Uma operação posterior cancelada não reabre o saldo de um ciclo anterior.
    return PARTIAL_BALANCE_OPERATION_STATUSES.includes(operation.status);
  });
}

/** Uma página incompleta não pode ser interpretada como saldo zerado. */
export async function readAllBalanceRows(
  fetchPage: (from: number, to: number) => Promise<PartialWriteoffBalanceRow[]>,
  pageSize = 1000,
): Promise<PartialWriteoffBalanceRow[]> {
  const rows: PartialWriteoffBalanceRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export type PendingPartialWriteoffItem = {
  line_key: string;
  product_id: string;
  variation_id: string | null;
  product_name: string;
  product_code: string;
  unit: string;
  original_quantity: number;
  withdrawn_quantity: number;
  pending_quantity: number;
};

const EPSILON = 0.000001;

function quantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeBudgetReference(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * O Pick & Pack e a view partial_writeoff_item_balances são a fonte oficial.
 * Reserva não é baixa: o saldo só diminui por withdrawn_quantity confirmado.
 */
export function pendingItemsFromBalanceRows(
  rows: PartialWriteoffBalanceRow[],
): PendingPartialWriteoffItem[] {
  return rows.flatMap((row) => {
    const original = quantity(row.original_quantity);
    const withdrawn = Math.min(original, quantity(row.withdrawn_quantity));
    const pendingFromView = quantity(row.pending_purchase_quantity);
    const pending = Number(Math.min(original, pendingFromView).toFixed(6));
    if (pending <= EPSILON) return [];

    return [{
      line_key: normalizeBudgetReference(row.line_key),
      product_id: normalizeBudgetReference(row.product_id),
      variation_id: normalizeBudgetReference(row.variation_id) || null,
      product_name: normalizeBudgetReference(row.product_name),
      product_code: normalizeBudgetReference(row.product_code),
      unit: normalizeBudgetReference(row.unit) || "UN",
      original_quantity: original,
      withdrawn_quantity: withdrawn,
      pending_quantity: pending,
    }];
  });
}
