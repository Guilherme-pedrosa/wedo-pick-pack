import { describe, expect, it } from 'vitest';
import {
  calculateDemandForecast,
  calculateNetPurchaseQty,
  isOneOffDemand,
  needsReactiveInventoryRestock,
} from './inventoryPlanning';

describe('needsReactiveInventoryRestock', () => {
  const base = {
    isInventoryItem: true,
    stockKnown: true,
    eventCount: 1,
    stockQty: 0,
    reorderPoint: 4,
    daysSinceLastConsumption: 33,
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

describe('inventory demand forecast', () => {
  it('usa o ritmo recente da máquina 200 II quando há várias vendas independentes', () => {
    const forecastMonthly = calculateDemandForecast({
      demandPattern: 'lumpy',
      historicalMonthlyAvg: 7 / 12,
      recentWeightedAvg: 2.6,
      recentWindowQty: 6,
      recentWindowDays: 60,
      recentSourceCount: 4,
    });

    expect(forecastMonthly).toBe(3);

    const safetyStock = 1;
    const leadTimeDays = 21;
    const coverageDays = 30;
    const targetQty = Math.ceil(
      (forecastMonthly / 30) * (leadTimeDays + coverageDays) + safetyStock,
    );

    expect(targetQty).toBe(7);
    expect(calculateNetPurchaseQty({
      targetQty,
      stockQty: 1,
      openPurchaseQty: 0,
    })).toBe(6);
  });

  it('não transforma uma única venda em lote em tendência recorrente', () => {
    expect(calculateDemandForecast({
      demandPattern: 'lumpy',
      historicalMonthlyAvg: 10 / 12,
      recentWeightedAvg: 5,
      recentWindowQty: 10,
      recentWindowDays: 60,
      recentSourceCount: 1,
    })).toBeCloseTo(10 / 12);

    expect(isOneOffDemand({
      sourceCount: 1,
      eventCount: 2,
      nonZeroMonths: 1,
    })).toBe(true);
  });

  it('aplica metade da aceleração quando há duas fontes recentes', () => {
    expect(calculateDemandForecast({
      demandPattern: 'lumpy',
      historicalMonthlyAvg: 1,
      recentWeightedAvg: 3,
      recentWindowQty: 6,
      recentWindowDays: 60,
      recentSourceCount: 2,
    })).toBe(2);
  });

  it('desconta pedido de compra aberto apenas uma vez', () => {
    expect(calculateNetPurchaseQty({
      targetQty: 7,
      stockQty: 1,
      openPurchaseQty: 2,
    })).toBe(4);

    expect(calculateNetPurchaseQty({
      targetQty: 7,
      stockQty: 1,
      openPurchaseQty: 10,
    })).toBe(0);

    expect(calculateNetPurchaseQty({
      targetQty: 7,
      stockQty: -2,
      openPurchaseQty: 0,
    })).toBe(9);
  });
});
