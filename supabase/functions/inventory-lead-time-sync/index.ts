const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const RATE_LIMIT_MS = 350;

// === Regras de qualidade do cálculo de lead time ===
// Mínimo de amostras válidas para o fornecedor entrar no resultado.
const MIN_SAMPLES = 3;
// Se >= BATCH_THRESHOLD compras tiveram a chegada registrada no MESMO DIA,
// consideramos que houve uma "limpeza administrativa" no GC e descartamos essas amostras.
const BATCH_THRESHOLD = 5;
// Limite máximo razoável para descarte de outliers extremos (mantemos amplo).
const MAX_LEAD_DAYS = 365;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface RawSample {
  compra_codigo: string;
  data_emissao: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  days: number;
}

interface SupplierBucket {
  name: string;
  rawSamples: RawSample[]; // todas as amostras antes do filtro de batch
}

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
    const startSituacaoId = String(config.purchase_lt_start_situacao_id || '');
    const arrivedSituacaoIds: string[] = (config.purchase_arrived_situacao_ids || []).map(String);

    if (!startSituacaoId) {
      return jsonResp({ error: 'Status de início (COMPRADO) não configurado na Política de Estoque.' }, 400);
    }
    if (arrivedSituacaoIds.length === 0) {
      return jsonResp({ error: 'Nenhuma situação de chegada configurada. Configure na Política de Estoque.' }, 400);
    }

    // === Buscar catálogo de situações para mapear ID -> NOME ===
    // No payload de cada Compra, dentro de `situacoes[].situacao`, o GC NÃO retorna
    // o ID do tipo de situação — apenas o nome (string) e um `id` que é o ID do
    // registro histórico (não do tipo). Por isso precisamos comparar pelo NOME.
    const sitCatalog = await gcRequest('/api/situacoes_compras', gcAccess, gcSecret);
    const idToName = new Map<string, string>();
    for (const item of (sitCatalog?.data || [])) {
      const it = item?.SituacaoCompra ?? item;
      if (it?.id && it?.nome) idToName.set(String(it.id), String(it.nome).trim());
    }

    const startSituacaoName = idToName.get(startSituacaoId);
    const arrivedSituacaoNames = new Set(
      arrivedSituacaoIds.map(id => idToName.get(id)).filter(Boolean) as string[]
    );

    if (!startSituacaoName) {
      return jsonResp({ error: `Status de início ID=${startSituacaoId} não encontrado no catálogo do GC.` }, 400);
    }
    if (arrivedSituacaoNames.size === 0) {
      return jsonResp({ error: 'Nenhum dos status de chegada configurados foi encontrado no GC.' }, 400);
    }

    // === Coleta bruta de amostras por fornecedor ===
    const supplierMap = new Map<string, SupplierBucket>();
    let docsScanned = 0;
    let docsSkippedNoStart = 0;
    let docsSkippedNoEnd = 0;

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
          docsScanned++;

          if (!fornecedorId) continue;

          // === DATA DE INÍCIO: APENAS via status COMPRADO explícito (sem fallback) ===
          let startDate: Date | null = null;
          let endDate: Date | null = null;

          for (const wrapper of situacoes) {
            const sit = wrapper?.situacao ?? wrapper;
            const sitId = String(sit?.situacao_id ?? sit?.id ?? '');
            const sitDate = sit?.data;
            if (!sitDate) continue;

            const parsed = new Date(sitDate);
            if (isNaN(parsed.getTime())) continue;

            // Início: SOMENTE se o ID bate com o status configurado como "COMPRADO"
            if (sitId === startSituacaoId) {
              if (!startDate || parsed < startDate) startDate = parsed;
            }

            // Chegada: ID bate com algum dos status configurados como "ARRIVED"
            if (arrivedSituacaoIds.includes(sitId)) {
              if (!endDate || parsed > endDate) endDate = parsed;
            }
          }

          if (!startDate) {
            docsSkippedNoStart++;
            continue;
          }
          if (!endDate) {
            docsSkippedNoEnd++;
            continue;
          }

          const diffMs = endDate.getTime() - startDate.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);

          // Descarta valores impossíveis (negativos ou > 1 ano)
          if (diffDays < 0 || diffDays > MAX_LEAD_DAYS) continue;

          if (!supplierMap.has(fornecedorId)) {
            supplierMap.set(fornecedorId, { name: fornecedorNome, rawSamples: [] });
          }

          supplierMap.get(fornecedorId)!.rawSamples.push({
            compra_codigo: String(doc.codigo ?? ''),
            data_emissao: String(doc.data_emissao ?? ''),
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            days: Math.round(diffDays),
          });
        }

        page++;
      }
    }

    // === Detector de batch updates: contar quantas chegadas caíram em cada dia GLOBAL ===
    // Se um único dia concentra >= BATCH_THRESHOLD chegadas (de fornecedores diferentes ou não),
    // é forte indício de mudança de status em lote no GC e essas amostras viram outliers.
    const endDateGlobalCount = new Map<string, number>();
    for (const bucket of supplierMap.values()) {
      for (const s of bucket.rawSamples) {
        endDateGlobalCount.set(s.end, (endDateGlobalCount.get(s.end) ?? 0) + 1);
      }
    }
    const batchEndDates = new Set<string>();
    for (const [date, count] of endDateGlobalCount) {
      if (count >= BATCH_THRESHOLD) batchEndDates.add(date);
    }

    // === Calcular MEDIANA por fornecedor, descartando amostras de batch ===
    const results: any[] = [];
    let suppliersDiscardedBatch = 0;
    let suppliersDiscardedFewSamples = 0;

    for (const [fornecedorId, data] of supplierMap) {
      // Filtra amostras que caíram em datas de batch update
      const cleanSamples = data.rawSamples.filter(s => !batchEndDates.has(s.end));

      if (cleanSamples.length === 0) {
        suppliersDiscardedBatch++;
        continue;
      }

      if (cleanSamples.length < MIN_SAMPLES) {
        suppliersDiscardedFewSamples++;
        continue;
      }

      const days = cleanSamples.map(s => s.days).sort((a, b) => a - b);
      const median = computeMedian(days);
      const min = days[0];
      const max = days[days.length - 1];
      const avg = days.reduce((s, v) => s + v, 0) / days.length;

      const row = {
        fornecedor_id: fornecedorId,
        fornecedor_nome: data.name,
        // Persistimos a MEDIANA no campo avg_lead_time_days (é o valor exibido na UI)
        avg_lead_time_days: Math.round(median * 10) / 10,
        min_lead_time_days: Math.round(min * 10) / 10,
        max_lead_time_days: Math.round(max * 10) / 10,
        sample_count: cleanSamples.length,
        samples: cleanSamples.slice(-20).map(s => ({
          ...s,
          // Marca metadados extras úteis para auditoria
          method: 'median',
          mean_days: Math.round(avg * 10) / 10,
        })),
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
      docs_scanned: docsScanned,
      docs_skipped_no_start: docsSkippedNoStart,
      docs_skipped_no_end: docsSkippedNoEnd,
      batch_end_dates_detected: Array.from(batchEndDates).sort(),
      suppliers_discarded_due_batch: suppliersDiscardedBatch,
      suppliers_discarded_few_samples: suppliersDiscardedFewSamples,
      min_samples_required: MIN_SAMPLES,
      data: results.map(r => ({
        fornecedor: r.fornecedor_nome,
        median_days: r.avg_lead_time_days,
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

function computeMedian(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2 : sortedAsc[mid];
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
