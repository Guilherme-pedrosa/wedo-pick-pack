import { PickingItem } from '@/api/types';

export function matchItemByCode(
  code: string,
  items: PickingItem[]
): PickingItem | null {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return null;
  return items.find(item =>
    item.codigo_produto?.toLowerCase() === normalized ||
    item.codigo_barras?.toLowerCase() === normalized ||
    item.produto_id?.toLowerCase() === normalized ||
    item.variacao_id?.toLowerCase() === normalized
  ) ?? null;
}
