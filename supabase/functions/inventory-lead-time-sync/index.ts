const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const RATE_LIMIT_MS = 350;

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
    // Load config to get start/arrived status IDs
    const { data: configs } = await supabase
      .from('inventory_policy_config')
      .select('purchase_lt_start_situacao_id, purchase_arrived_situacao_ids')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!configs?.length) {
      return jsonResp({ error: 'No inventory policy config found' }, 400);
    }

    const config = configs[0];
    const startSituacaoId = config.purchase_lt_start_situacao_id;
    const arrivedSituacaoIds: string[] = config.purchase_arrived_situacao_ids || [];

    if (arrivedSituacaoIds.length === 0) {
      return jsonResp({ error: 'Nenhuma situação de chegada configurada. Configure na Política de Estoque.' }, 400);
    }

    // Fetch completed purchase orders (arrived statuses) — they have full situacoes history
    const supplierMap = new Map<string, { name: string; leadTimes: number[]; samples: any[] }>();

    for (const arrivedId of arrivedSituacaoIds) {
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        await sleep(RATE_LIMIT_MS);
        const params = new URLSearchParams({ situacao_id: arrivedId, pagina: String(page) });
        const res = await gcRequest(`/api/compras?${params}`, gcAccess, gcSecret);
        const docs = res?.data || [];
        const meta = res?.meta || {};
        totalPages = meta.total_paginas || 1;

        for (const raw of docs) {
          const doc = raw?.Compra ?? raw;
          const fornecedorId = String(doc.fornecedor_id || '');
          const fornecedorNome = String(doc.nome_fornecedor || 'Desconhecido');
          const situacoes: any[] = doc.situacoes || [];
          const dataEmissao = doc.data_emissao;

          if (!fornecedorId || !dataEmissao) continue;

          // Find the start date: either the status change to "start" or data_emissao
          let startDate: Date | null = null;
          let endDate: Date | null = null;

          for (const wrapper of situacoes) {
            const sit = wrapper?.situacao ?? wrapper;
            const sitId = String(sit?.situacao_id ?? sit?.id ?? '');
            const sitDate = sit?.data;
            if (!sitDate) continue;

            const parsed = new Date(sitDate);
            if (isNaN(parsed.getTime())) continue;

            // Check if this is the start status
            if (sitId === startSituacaoId || String(sit?.situacao ?? '').toUpperCase().includes('COMPRADO')) {
              if (!startDate || parsed < startDate) startDate = parsed;
            }

            // Check if this is an arrived status
            if (arrivedSituacaoIds.includes(sitId) || 
                String(sit?.situacao ?? '').toUpperCase().includes('FINALIZADO') ||
                String(sit?.situacao ?? '').toUpperCase().includes('CHEGOU')) {
              if (!endDate || parsed > endDate) endDate = parsed;
            }
          }

          // Fallback: use data_emissao as start
          if (!startDate) {
            startDate = new Date(dataEmissao);
          }

          if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

          const diffMs = endDate.getTime() - startDate.getTime();
          const diffDays = Math.max(0, diffMs / (1000 * 60 * 60 * 24));

          // Ignore outliers (> 365 days or < 0)
          if (diffDays > 365 || diffDays < 0) continue;

          if (!supplierMap.has(fornecedorId)) {
            supplierMap.set(fornecedorId, { name: fornecedorNome, leadTimes: [], samples: [] });
          }

          const entry = supplierMap.get(fornecedorId)!;
          entry.leadTimes.push(diffDays);
          entry.samples.push({
            compra_codigo: doc.codigo,
            data_emissao: dataEmissao,
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            days: Math.round(diffDays),
          });
        }

        page++;
      }
    }

    // Upsert supplier lead times
    const results: any[] = [];
    for (const [fornecedorId, data] of supplierMap) {
      if (data.leadTimes.length === 0) continue;

      const sorted = [...data.leadTimes].sort((a, b) => a - b);
      const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      const row = {
        fornecedor_id: fornecedorId,
        fornecedor_nome: data.name,
        avg_lead_time_days: Math.round(avg * 10) / 10,
        min_lead_time_days: Math.round(min * 10) / 10,
        max_lead_time_days: Math.round(max * 10) / 10,
        sample_count: sorted.length,
        samples: data.samples.slice(-20), // keep last 20 samples
        last_synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('supplier_lead_times')
        .upsert(row, { onConflict: 'fornecedor_id' });

      if (error) {
        console.error(`Failed to upsert lead time for ${fornecedorId}:`, error);
      }

      results.push(row);
    }

    return jsonResp({
      success: true,
      suppliers_analyzed: results.length,
      data: results.map(r => ({
        fornecedor: r.fornecedor_nome,
        avg_days: r.avg_lead_time_days,
        min_days: r.min_lead_time_days,
        max_days: r.max_lead_time_days,
        samples: r.sample_count,
      })),
    });
  } catch (err) {
    console.error('inventory-lead-time-sync error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
