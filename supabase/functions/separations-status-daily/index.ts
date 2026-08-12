import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { withGcApiUser } from '../_shared/gc-api-user.ts';

const GC_API_URL = 'https://api.gestaoclick.com';

interface SeparationRow {
  id: string;
  order_type: string;
  order_id: string;
  order_code: string | null;
  status_id: string | null;
  target_status_id: string | null;
  invalidated: boolean;
}

async function gcGetOrder(
  orderType: string,
  orderId: string,
  accessToken: string,
  secretToken: string,
): Promise<{ nome_situacao: string; situacao_id: string } | null> {
  const path = orderType === 'os' ? `/api/ordens_servicos/${orderId}` : `/api/vendas/${orderId}`;
  try {
    const res = await fetch(withGcApiUser(path, GC_API_URL), {
      headers: {
        'access-token': accessToken,
        'secret-access-token': secretToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.error(`GC ${path} -> ${res.status}`);
      return null;
    }
    const json = await res.json();
    const data = json?.data;
    if (!data) return null;
    return {
      nome_situacao: data.nome_situacao || '—',
      situacao_id: String(data.situacao_id || ''),
    };
  } catch (err) {
    console.error(`Error fetching ${path}:`, err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GC_ACCESS_TOKEN = Deno.env.get('GC_ACCESS_TOKEN');
  const GC_SECRET_TOKEN = Deno.env.get('GC_SECRET_TOKEN');

  if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) {
    return new Response(JSON.stringify({ error: 'GC credentials not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // Load ALL active separations (entire history, not just last 24h)
    const { data: seps, error: sepErr } = await supabase
      .from('separations')
      .select('id, order_type, order_id, order_code, status_id, target_status_id, invalidated')
      .eq('invalidated', false);

    if (sepErr) throw sepErr;
    const active = (seps || []) as SeparationRow[];

    if (active.length === 0) {
      return new Response(JSON.stringify({ ok: true, checked: 0, message: 'No active separations' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate by order
    const orderMap = new Map<string, { order_type: string; order_id: string; order_code: string | null }>();
    for (const s of active) {
      const key = `${s.order_type}:${s.order_id}`;
      if (!orderMap.has(key)) {
        orderMap.set(key, { order_type: s.order_type, order_id: s.order_id, order_code: s.order_code });
      }
    }
    const uniqueOrders = Array.from(orderMap.values());

    // Fetch each order with 1.1s throttling
    const orderResults = new Map<string, { nome_situacao: string; situacao_id: string }>();
    for (let i = 0; i < uniqueOrders.length; i++) {
      const o = uniqueOrders[i];
      const r = await gcGetOrder(o.order_type, o.order_id, GC_ACCESS_TOKEN, GC_SECRET_TOKEN);
      if (r) orderResults.set(`${o.order_type}:${o.order_id}`, r);
      if (i < uniqueOrders.length - 1) await new Promise((res) => setTimeout(res, 1100));
    }

    // --- Track GC status changes into gc_status_snapshots + system_logs ---
    const orderIds = uniqueOrders.map((o) => o.order_id);
    const { data: snaps } = await supabase
      .from('gc_status_snapshots')
      .select('order_type, order_id, situacao_id, nome_situacao')
      .in('order_id', orderIds);

    const snapMap = new Map<string, { situacao_id: string | null; nome_situacao: string | null }>();
    for (const s of snaps || []) {
      snapMap.set(`${s.order_type}:${s.order_id}`, { situacao_id: s.situacao_id, nome_situacao: s.nome_situacao });
    }

    let statusChanges = 0;
    for (const o of uniqueOrders) {
      const key = `${o.order_type}:${o.order_id}`;
      const r = orderResults.get(key);
      if (!r || !r.situacao_id) continue;
      const prev = snapMap.get(key);

      await supabase.from('gc_status_snapshots').upsert(
        {
          order_type: o.order_type,
          order_id: o.order_id,
          situacao_id: r.situacao_id,
          nome_situacao: r.nome_situacao,
        },
        { onConflict: 'order_type,order_id' },
      );

      if (!prev) continue;
      if (String(prev.situacao_id || '') !== String(r.situacao_id)) {
        statusChanges++;
        await supabase.from('system_logs').insert({
          user_id: null,
          user_name: 'Sistema (Automático 06h)',
          module: 'separations',
          action: 'gc_status_change',
          entity_type: o.order_type,
          entity_id: o.order_id,
          entity_name: `${o.order_type === 'os' ? 'OS' : 'Venda'} #${o.order_code || o.order_id}`,
          details: {
            from_situacao: prev.nome_situacao,
            from_situacao_id: prev.situacao_id,
            to_situacao: r.nome_situacao,
            to_situacao_id: r.situacao_id,
            source: 'GestãoClick',
            via: 'daily_06h',
          },
        });
      }
    }

    // --- Invalidate separations reverted to pre-separation status ---
    let invalidated = 0;
    const nowIso = new Date().toISOString();
    for (const s of active) {
      const r = orderResults.get(`${s.order_type}:${s.order_id}`);
      if (!r) continue;
      if (r.situacao_id === s.status_id && r.situacao_id !== s.target_status_id) {
        const reason = `Status revertido no GC: "${r.nome_situacao}" (voltou ao status anterior à separação)`;
        const { error } = await supabase
          .from('separations')
          .update({ invalidated: true, invalidated_at: nowIso, invalidated_reason: reason })
          .eq('id', s.id)
          .select('id');
        if (!error) invalidated++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, checked: uniqueOrders.length, statusChanges, invalidated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('separations-status-daily error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
