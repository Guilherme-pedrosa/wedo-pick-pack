// supabase/functions/push-watcher/index.ts
// Polling watcher (cron 1/min) que diffa a fila do checkout (OS + Vendas)
// e dispara push notifications:
//  - new_order:     pedido apareceu em status configurado para mostrar
//  - order_taken:   pedido sumiu da fila (concluído por outro operador)
//  - stock_regression: separations.target_status_id baixava estoque mas
//                      situação atual no GC não baixa
//
// Estado anterior salvo em push_watcher_state.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

async function gc(path: string): Promise<any> {
  const res = await fetch(`${PROJECT_URL}/functions/v1/gc-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: ANON,
    },
    body: JSON.stringify({ path, method: 'GET' }),
  });
  if (!res.ok) throw new Error(`gc-proxy ${res.status}`);
  return await res.json();
}

interface QueueEntry {
  type: 'os' | 'venda';
  id: string;
  codigo: string;
  cliente: string;
  situacao_id: string;
  situacao_nome: string;
}

async function fetchQueueForStatuses(
  type: 'os' | 'venda',
  statusIds: string[]
): Promise<QueueEntry[]> {
  const out: QueueEntry[] = [];
  for (const sid of statusIds) {
    try {
      const path =
        type === 'os'
          ? `/api/ordens_servicos?situacao_id=${sid}&pagina=1`
          : `/api/vendas?situacao_id=${sid}&pagina=1`;
      const json = await gc(path);
      const arr = Array.isArray(json?.data) ? json.data : [];
      for (const item of arr) {
        out.push({
          type,
          id: String(item.id),
          codigo: String(item.codigo || item.id),
          cliente: String(item.nome_cliente || item.cliente?.nome || ''),
          situacao_id: String(item.situacao_id || sid),
          situacao_nome: String(item.nome_situacao || ''),
        });
      }
    } catch (e) {
      console.error(`fetchQueue ${type} ${sid}`, e);
    }
  }
  return out;
}

async function sendPush(
  admin: any,
  eventType: string,
  title: string,
  body: string,
  url: string,
  tag?: string,
  userIds?: string[]
) {
  await fetch(`${PROJECT_URL}/functions/v1/push-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: ANON,
    },
    body: JSON.stringify({
      event_type: eventType,
      title,
      body,
      url,
      tag,
      user_ids: userIds,
    }),
  });
}

async function alreadyNotified(
  admin: any,
  eventType: string,
  key: string
): Promise<boolean> {
  const { data } = await admin
    .from('push_event_log')
    .insert({ event_type: eventType, event_key: key })
    .select();
  if (data && data.length) return false;
  return true; // unique violation => já notificado
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(PROJECT_URL, SERVICE_KEY);

    // 1) Coleta união de status configurados em todos os profiles
    const { data: profiles } = await admin
      .from('profiles')
      .select('id,os_status_to_show,venda_status_to_show');

    const osStatusSet = new Set<string>();
    const vendaStatusSet = new Set<string>();
    for (const p of profiles || []) {
      (p.os_status_to_show || []).forEach((s: string) => s && osStatusSet.add(String(s)));
      (p.venda_status_to_show || []).forEach((s: string) => s && vendaStatusSet.add(String(s)));
    }

    const queue: QueueEntry[] = [
      ...(await fetchQueueForStatuses('os', [...osStatusSet])),
      ...(await fetchQueueForStatuses('venda', [...vendaStatusSet])),
    ];

    // Remove pedidos já separados (não interessa notificar de novo)
    const { data: separated } = await admin
      .from('separations')
      .select('order_id')
      .eq('invalidated', false);
    const sepSet = new Set((separated || []).map((s: any) => String(s.order_id)));
    const queueFiltered = queue.filter((q) => !sepSet.has(q.id));

    // 2) Lê estado anterior
    const { data: prevRow } = await admin
      .from('push_watcher_state')
      .select('payload')
      .eq('id', 'queue')
      .maybeSingle();

    const prevIds: Set<string> = new Set(
      (prevRow?.payload?.ids as string[]) || []
    );
    const currentIds = new Set(queueFiltered.map((q) => `${q.type}:${q.id}`));

    // 3) Diff
    const newOnes: QueueEntry[] = [];
    for (const q of queueFiltered) {
      const k = `${q.type}:${q.id}`;
      if (!prevIds.has(k)) newOnes.push(q);
    }
    const taken: string[] = [];
    for (const k of prevIds) if (!currentIds.has(k)) taken.push(k);

    // 4) Eventos: novo pedido
    const isFirstRun = !prevRow;
    if (!isFirstRun) {
      for (const q of newOnes) {
        const dedupKey = `${q.type}:${q.id}`;
        const skip = await alreadyNotified(admin, 'new_order', dedupKey);
        if (skip) continue;
        const label = q.type === 'os' ? 'Nova OS' : 'Nova Venda';
        await sendPush(
          admin,
          'new_order',
          `${label} #${q.codigo}`,
          `${q.cliente}${q.situacao_nome ? ' — ' + q.situacao_nome : ''}`,
          '/checkout',
          `new-${q.type}-${q.id}`
        );
      }

      // 5) Eventos: pedido removido (provavelmente pego por outro operador)
      const prevList: QueueEntry[] = (prevRow?.payload?.list as QueueEntry[]) || [];
      for (const k of taken) {
        const before = prevList.find((p) => `${p.type}:${p.id}` === k);
        if (!before) continue;
        const dedupKey = `taken:${k}:${Math.floor(Date.now() / (5 * 60 * 1000))}`;
        const skip = await alreadyNotified(admin, 'order_taken', dedupKey);
        if (skip) continue;
        const label = before.type === 'os' ? 'OS' : 'Venda';
        await sendPush(
          admin,
          'order_taken',
          `${label} #${before.codigo} saiu da fila`,
          `${before.cliente} — provavelmente concluída/movida.`,
          '/checkout',
          `taken-${before.type}-${before.id}`
        );
      }
    }

    // 6) Stock regressions (separations onde live status difere de target stockout)
    const { data: cfg } = await admin
      .from('inventory_policy_config')
      .select('os_stockout_situacao_ids,vendas_stockout_situacao_ids')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cfg) {
      const stockoutSet = new Set<string>([
        ...(cfg.os_stockout_situacao_ids || []).map(String),
        ...(cfg.vendas_stockout_situacao_ids || []).map(String),
      ]);
      // Foca nas separações concluídas nos últimos 7 dias
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: seps } = await admin
        .from('separations')
        .select('id,order_id,order_code,order_type,target_status_id,client_name')
        .eq('invalidated', false)
        .gte('concluded_at', since);

      for (const sep of seps || []) {
        const targetDebits = stockoutSet.has(String(sep.target_status_id));
        if (!targetDebits) continue;
        // Pega situação atual no GC
        try {
          const path =
            sep.order_type === 'os'
              ? `/api/ordens_servicos/${sep.order_id}`
              : `/api/vendas/${sep.order_id}`;
          const json = await gc(path);
          const live = json?.data;
          if (!live) continue;
          const liveSit = String(live.situacao_id || '');
          const liveDebits = stockoutSet.has(liveSit);
          if (liveDebits) continue;

          const dedupKey = `regression:${sep.id}:${liveSit}`;
          const skip = await alreadyNotified(admin, 'stock_regression', dedupKey);
          if (skip) continue;

          await sendPush(
            admin,
            'stock_regression',
            `⚠️ Estoque NÃO baixou — #${sep.order_code}`,
            `${sep.client_name} — status atual no ERP não baixa estoque.`,
            '/separations',
            `regression-${sep.id}`
          );
        } catch (e) {
          console.error('regression check', e);
        }
      }
    }

    // 7) Persiste estado
    await admin.from('push_watcher_state').upsert({
      id: 'queue',
      payload: {
        ids: [...currentIds],
        list: queueFiltered,
        ts: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        ok: true,
        queue_size: queueFiltered.length,
        new_orders: newOnes.length,
        taken: taken.length,
        first_run: isFirstRun,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('[push-watcher]', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
