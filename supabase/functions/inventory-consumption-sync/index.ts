const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const RATE_LIMIT_MS = 350; // ~3 req/s

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const gcAccess = Deno.env.get('GC_ACCESS_TOKEN')!;
  const gcSecret = Deno.env.get('GC_SECRET_TOKEN')!;

  if (!gcAccess || !gcSecret) {
    return jsonResp({ error: 'GC credentials not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Load active config
    const { data: configs, error: cfgErr } = await supabase
      .from('inventory_policy_config')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (cfgErr || !configs?.length) {
      return jsonResp({ error: 'No inventory policy config found' }, 400);
    }

    const config = configs[0];
    const lookbackDays = config.lookback_days || 180;
    const vendasSituacaoIds: string[] = config.vendas_stockout_situacao_ids || [];
    const osSituacaoIds: string[] = config.os_stockout_situacao_ids || [];

    if (vendasSituacaoIds.length === 0 && osSituacaoIds.length === 0) {
      return jsonResp({ error: 'No situações selected for(stock out). Configure policies first.' }, 400);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    const stats = { docs_seen: 0, docs_debited: 0, items_created: 0, errors: 0 };

    // 2. Process Vendas
    for (const sitId of vendasSituacaoIds) {
      await processDocType('venda', sitId, startStr, endStr, supabase, gcAccess, gcSecret, stats);
    }

    // 3. Process OS
    for (const sitId of osSituacaoIds) {
      await processDocType('os', sitId, startStr, endStr, supabase, gcAccess, gcSecret, stats);
    }

    // 4. Log to system_logs via service role
    // Extract operator from auth header if available
    let operatorId = 'system';
    let operatorName = 'System Sync';
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        operatorId = user.id;
        const { data: prof } = await supabase.from('profiles').select('name').eq('id', user.id).single();
        operatorName = prof?.name || user.email || 'Unknown';
      }
    }

    await supabase.from('system_logs').insert({
      user_id: operatorId,
      user_name: operatorName,
      module: 'inventory',
      action: 'Sincronização de consumo executada',
      details: { ...stats, period: `${startStr} → ${endStr}`, lookback_days: lookbackDays },
    });

    return jsonResp({ success: true, stats, period: { start: startStr, end: endStr } });
  } catch (err) {
    console.error('inventory-consumption-sync error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

async function processDocType(
  docType: 'venda' | 'os',
  situacaoId: string,
  startStr: string,
  endStr: string,
  supabase: any,
  gcAccess: string,
  gcSecret: string,
  stats: { docs_seen: number; docs_debited: number; items_created: number; errors: number },
) {
  const endpoint = docType === 'venda' ? '/api/vendas' : '/api/ordens_servicos';
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const params = new URLSearchParams({
      situacao_id: situacaoId,
      data_inicio: startStr,
      data_fim: endStr,
      pagina: String(page),
    });

    try {
      await sleep(RATE_LIMIT_MS);
      const res = await gcRequest(`${endpoint}?${params}`, gcAccess, gcSecret);
      const docs = res?.data || [];
      const meta = res?.meta || {};
      totalPages = meta.total_paginas || 1;

      for (const doc of docs) {
        stats.docs_seen++;
        try {
          await processDocument(docType, doc, situacaoId, supabase, stats);
        } catch (e) {
          console.error(`Error processing ${docType} ${doc.id}:`, e);
          stats.errors++;
        }
      }
    } catch (e) {
      console.error(`Error fetching ${endpoint} page ${page}:`, e);
      stats.errors++;
      // If rate limited, wait and retry
      if (e instanceof Error && e.message === 'RATE_LIMIT') {
        await sleep(2000);
        continue; // retry same page
      }
    }
    page++;
  }
}

async function processDocument(
  docType: 'venda' | 'os',
  doc: any,
  situacaoId: string,
  supabase: any,
  stats: { docs_debited: number; items_created: number },
) {
  const docId = String(doc.id);

  // Check if already processed (idempotency)
  const { data: existing } = await supabase
    .from('doc_stock_effect')
    .select('id, debited')
    .eq('doc_type', docType)
    .eq('doc_id', docId)
    .maybeSingle();

  if (existing?.debited) {
    // Already debited — update last_seen_at only
    await supabase
      .from('doc_stock_effect')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id);
    return;
  }

  // Extract items from document
  const produtos = doc.produtos || [];
  const items: Array<{ produto_id: string; variacao_id: string | null; qty: number; raw: any }> = [];

  for (const p of produtos) {
    const prod = p.produto || p;
    const qty = parseFloat(String(prod.quantidade || 0));
    if (qty > 0) {
      items.push({
        produto_id: String(prod.produto_id),
        variacao_id: prod.variacao_id ? String(prod.variacao_id) : null,
        qty,
        raw: prod,
      });
    }
  }

  if (items.length === 0) return;

  const now = new Date().toISOString();
  const occurredAt = doc.data || now;

  // Insert consumption events
  const events = items.map(item => ({
    occurred_at: occurredAt,
    source_type: docType,
    source_id: docId,
    situacao_id: situacaoId,
    produto_id: item.produto_id,
    variacao_id: item.variacao_id,
    qty: item.qty,
    valor_custo: item.raw.valor_custo ? parseFloat(String(item.raw.valor_custo)) : null,
    raw: item.raw,
  }));

  const { error: insertErr } = await supabase.from('inventory_consumption_events').insert(events);
  if (insertErr) {
    console.error(`Failed to insert events for ${docType}/${docId}:`, insertErr);
    throw insertErr;
  }

  stats.items_created += items.length;

  // Upsert doc_stock_effect
  if (existing) {
    await supabase
      .from('doc_stock_effect')
      .update({ debited: true, debited_at: now, debit_situacao_id: situacaoId, last_seen_at: now })
      .eq('id', existing.id);
  } else {
    await supabase.from('doc_stock_effect').insert({
      doc_type: docType,
      doc_id: docId,
      debited: true,
      debited_at: now,
      debit_situacao_id: situacaoId,
      first_seen_at: now,
      last_seen_at: now,
    });
  }

  stats.docs_debited++;
}

async function gcRequest(path: string, access: string, secret: string): Promise<any> {
  const url = `${GC_API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'access-token': access,
      'secret-access-token': secret,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GC API error ${res.status}: ${body}`);
  }

  return res.json();
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
