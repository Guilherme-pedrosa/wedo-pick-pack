export const RECENT_REACTIVE_RESTOCK_DAYS = 90;

interface ReactiveRestockInput {
  isInventoryItem: boolean;
  stockKnown: boolean;
  eventCount: number;
  stockQty: number;
  reorderPoint: number;
  daysSinceLastConsumption: number;
  recentWindowDays?: number;
}

/**
 * Reposição reativa só é válida quando houve saída recente de um produto que
 * efetivamente movimenta estoque. Estoque zerado, sozinho, não prova demanda.
 */
export function needsReactiveInventoryRestock({
  isInventoryItem,
  stockKnown,
  eventCount,
  stockQty,
  reorderPoint,
  daysSinceLastConsumption,
  recentWindowDays = RECENT_REACTIVE_RESTOCK_DAYS,
}: ReactiveRestockInput): boolean {
  return (
    isInventoryItem &&
    stockKnown &&
    eventCount > 0 &&
    stockQty <= reorderPoint &&
    daysSinceLastConsumption <= recentWindowDays
  );
}
