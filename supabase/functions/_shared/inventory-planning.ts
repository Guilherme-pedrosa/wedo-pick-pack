export type InventoryDemandPattern =
  | 'regular'
  | 'intermitente'
  | 'erratica'
  | 'lumpy'
  | 'sem_demanda';

interface DemandForecastInput {
  demandPattern: InventoryDemandPattern;
  historicalMonthlyAvg: number;
  recentWeightedAvg: number;
  recentWindowQty?: number;
  recentWindowDays?: number;
  recentSourceCount?: number;
}

interface OneOffDemandInput {
  sourceCount: number;
  eventCount: number;
  nonZeroMonths: number;
}

interface NetPurchaseInput {
  targetQty: number;
  stockQty: number;
  openPurchaseQty: number;
}

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Forecast shared by the live analysis and the persisted planning job.
 *
 * Lumpy demand must not dilute a recent acceleration over twelve months, but a
 * single large order must not become a recurring stock policy either. Distinct
 * recent documents provide the confidence for applying the recent run rate:
 * one source keeps the historical baseline, two use half of the uplift and
 * three or more use the complete recent signal.
 */
export function calculateDemandForecast({
  demandPattern,
  historicalMonthlyAvg,
  recentWeightedAvg,
  recentWindowQty = 0,
  recentWindowDays = 60,
  recentSourceCount = 0,
}: DemandForecastInput): number {
  const historical = finiteNonNegative(historicalMonthlyAvg);
  const weightedRecent = finiteNonNegative(recentWeightedAvg);

  if (demandPattern === 'sem_demanda') return 0;
  if (demandPattern === 'intermitente') {
    return Math.max(historical, weightedRecent * 0.7);
  }
  if (demandPattern !== 'lumpy') {
    return Math.max(historical, weightedRecent);
  }

  const windowDays = finiteNonNegative(recentWindowDays);
  const rollingMonthly = windowDays > 0
    ? finiteNonNegative(recentWindowQty) * 30 / windowDays
    : 0;
  const recentSignal = Math.max(weightedRecent, rollingMonthly);
  const confidence = Math.min(1, Math.max(0, (finiteNonNegative(recentSourceCount) - 1) / 2));

  return Math.max(
    historical,
    historical + confidence * Math.max(0, recentSignal - historical),
  );
}

export function isOneOffDemand({
  sourceCount,
  nonZeroMonths,
}: OneOffDemandInput): boolean {
  return sourceCount <= 1 && nonZeroMonths <= 1;
}

/** Open purchase orders are already part of the net position and are deducted once. */
export function calculateNetPurchaseQty({
  targetQty,
  stockQty,
  openPurchaseQty,
}: NetPurchaseInput): number {
  const currentStock = Number.isFinite(stockQty) ? stockQty : 0;
  return Math.max(
    0,
    Math.ceil(
      finiteNonNegative(targetQty) -
      currentStock -
      finiteNonNegative(openPurchaseQty),
    ),
  );
}
