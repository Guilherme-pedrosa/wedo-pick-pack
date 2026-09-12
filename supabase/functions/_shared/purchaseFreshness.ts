export const PURCHASE_SCAN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export function purchaseScanDue(lastSuccess: string | null | undefined, now = Date.now()): boolean {
  const last = Date.parse(lastSuccess || '');
  return !Number.isFinite(last) || now - last >= PURCHASE_SCAN_INTERVAL_MS;
}
export function purchaseSnapshotStale(lastSuccess: string | null | undefined, now = Date.now()): boolean {
  const last = Date.parse(lastSuccess || '');
  return !Number.isFinite(last) || now - last >= PURCHASE_SCAN_INTERVAL_MS + 60 * 60 * 1000;
}
