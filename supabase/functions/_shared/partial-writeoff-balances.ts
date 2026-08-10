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
