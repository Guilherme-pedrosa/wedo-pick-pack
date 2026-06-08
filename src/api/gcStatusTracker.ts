import { supabase } from '@/integrations/supabase/client';
import { logSystemAction } from '@/lib/systemLog';

export interface ObservedStatus {
  order_type: 'os' | 'venda';
  order_id: string;
  order_code?: string;
  situacao_id: string;
  nome_situacao: string;
}

/**
 * Compares freshly fetched GC statuses against the last recorded snapshot.
 * When a status differs (or is seen for the first time after a baseline),
 * it records the change into system_logs so GC-only changes appear in the
 * separation history timeline — even when the change was made directly in GC.
 */
export async function trackGcStatusChanges(observed: ObservedStatus[]): Promise<void> {
  if (observed.length === 0) return;

  const orderIds = Array.from(new Set(observed.map(o => o.order_id)));

  // Load existing snapshots for these orders
  const { data: snaps } = await supabase
    .from('gc_status_snapshots')
    .select('order_type, order_id, situacao_id, nome_situacao')
    .in('order_id', orderIds);

  const snapMap = new Map<string, { situacao_id: string | null; nome_situacao: string | null }>();
  for (const s of snaps || []) {
    snapMap.set(`${s.order_type}:${s.order_id}`, { situacao_id: s.situacao_id, nome_situacao: s.nome_situacao });
  }

  for (const o of observed) {
    if (!o.situacao_id) continue;
    const key = `${o.order_type}:${o.order_id}`;
    const prev = snapMap.get(key);

    // Upsert the snapshot to the current status
    await supabase
      .from('gc_status_snapshots')
      .upsert(
        {
          order_type: o.order_type,
          order_id: o.order_id,
          situacao_id: o.situacao_id,
          nome_situacao: o.nome_situacao,
        },
        { onConflict: 'order_type,order_id' }
      );

    // First time we see this order → just establish the baseline, no change log
    if (!prev) continue;

    // Status changed since last observation → log it (catches GC-only changes)
    if (String(prev.situacao_id || '') !== String(o.situacao_id)) {
      await logSystemAction({
        module: 'separations',
        action: 'gc_status_change',
        entityType: o.order_type,
        entityId: o.order_id,
        entityName: `${o.order_type === 'os' ? 'OS' : 'Venda'} #${o.order_code || o.order_id}`,
        details: {
          from_situacao: prev.nome_situacao,
          from_situacao_id: prev.situacao_id,
          to_situacao: o.nome_situacao,
          to_situacao_id: o.situacao_id,
          source: 'GestãoClick',
        },
      });
    }
  }
}
