import { describe, expect, it } from 'vitest';
import { needsReactiveInventoryRestock } from './inventoryPlanning';

describe('needsReactiveInventoryRestock', () => {
  const base = {
    isInventoryItem: true,
    stockKnown: true,
    eventCount: 1,
    stockQty: 0,
    reorderPoint: 4,
    daysSinceLastConsumption: 63,
  };

  it('pede reposição para a bandeja GN 1/1 65 mm zerada após saída recente', () => {
    expect(needsReactiveInventoryRestock(base)).toBe(true);
  });

  it('não compra item zerado apenas por uma saída antiga', () => {
    expect(needsReactiveInventoryRestock({ ...base, daysSinceLastConsumption: 400 })).toBe(false);
  });

  it('não compra quando o produto não movimenta estoque no GC', () => {
    expect(needsReactiveInventoryRestock({ ...base, isInventoryItem: false })).toBe(false);
  });

  it('não compra sem saldo atual conhecido', () => {
    expect(needsReactiveInventoryRestock({ ...base, stockKnown: false })).toBe(false);
  });
});
