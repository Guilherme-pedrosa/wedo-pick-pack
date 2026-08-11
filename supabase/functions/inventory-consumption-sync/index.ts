const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GC_API_URL = 'https://api.gestaoclick.com';
const RATE_LIMIT_MS = 350;
const GC_API_USER_ID = '1320473';
const MIN_RECONCILIATION_DAYS = 12 * 31;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { shouldCountInventoryConsumption } from '../_shared/inventory-consumption-policy.ts';
import { activePartialWriteoffSourceIds } from '../_shared/partial-writeoff-consumption.ts';

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
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'sync_page'; // 'start' | 'sync_page' | 'finish'

    if (action === 'status') {
      return jsonResp({
        ok: true,
        version: 'configured-policy-authoritative-v1',
        totalTasks: 2,
        policyPrecedence: 'configured_situation_or_gc_positive_stock_effect',
      });
    }

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
    // A rotina diária reconcilia a janela anual completa. A atualização manual
    // da tela pode pedir uma janela menor para trazer movimentos recentes com
    // rapidez; a reconciliação diária continua corrigindo alterações antigas.
    const configuredLookbackDays = Math.max(
      Number(config.lookback_days) || MIN_RECONCILIATION_DAYS,
      MIN_RECONCILIATION_DAYS,
    );
    const requestedLookbackDays = Number(body.lookback_days);
    const lookbackDays = Number.isFinite(requestedLookbackDays) && requestedLookbackDays > 0
      ? Math.min(Math.ceil(requestedLookbackDays), configuredLookbackDays)
      : configuredLookbackDays;
    const vendasSituacaoIds: string[] = config.vendas_stockout_situacao_ids || [];
    const osSituacaoIds: string[] = config.os_stockout_situacao_ids || [];

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    // O efeito real positivo no estoque (situacao_estoque=1) inclui documentos
    // automaticamente. As situações selecionadas na Política de Estoque também
    // são autoritativas: elas representam saídas definidas pelo usuário mesmo
    // quando o GC retorna situacao_estoque=0 (ex.: VENDA FUTURA já despachada).
    const tasks: Array<{ docType: 'venda' | 'os'; fallbackSituacaoIds: string[] }> = [
      { docType: 'venda', fallbackSituacaoIds: vendasSituacaoIds.map(String) },
      { docType: 'os', fallbackSituacaoIds: osSituacaoIds.map(String) },
    ];

    // Resume state from request body
    const cursor = body.cursor || { taskIndex: 0, page: 1, stats: { os_seen: 0, vendas_seen: 0, os_debited: 0, vendas_debited: 0, pecas_created: 0, skipped: 0, errors: 0 } };
    const taskIndex = cursor.taskIndex;
    const page = cursor.page;
    const stats = cursor.stats;

    if (taskIndex >= tasks.length) {
      // All done — log and return final
      await logCompletion(req, supabase, stats, startStr, endStr, lookbackDays);
      return jsonResp({ done: true, stats, period: { start: startStr, end: endStr } });
    }

    const task = tasks[taskIndex];
    const endpoint = task.docType === 'venda' ? '/api/vendas' : '/api/ordens_servicos';

    const params = new URLSearchParams({
      data_inicio: startStr,
      data_fim: endStr,
      pagina: String(page),
      limite: '100',
      usuario_id: GC_API_USER_ID,
    });

    let totalPages = 1;
    let totalRegistros = 0;

    try {
      await sleep(RATE_LIMIT_MS);
      const res = await gcRequest(`${endpoint}?${params}`, gcAccess, gcSecret);
      const docs = res?.data || [];
      const meta = res?.meta || {};
      totalPages = meta.total_paginas || 1;
      totalRegistros = meta.total_registros || 0;

      if (task.docType === 'os') stats.os_seen += docs.length;
      else stats.vendas_seen += docs.length;

      try {
        await processDocumentPage(task.docType, docs, task.fallbackSituacaoIds, supabase, stats);
      } catch (e) {
        console.error(`Error processing ${task.docType} page ${page}:`, e);
        throw e;
      }
    } catch (e) {
      console.error(`Error fetching ${endpoint} page ${page}:`, e);
      stats.errors++;
      if (e instanceof Error && e.message === 'RATE_LIMIT') {
        // Return same cursor to retry
        return jsonResp({
          done: false,
          cursor: { taskIndex, page, stats },
          progress: buildProgress(taskIndex, tasks.length, page, totalPages, stats),
          retry: true,
        });
      }
      throw e;
    }

    // Determine next cursor
    let nextTaskIndex = taskIndex;
    let nextPage = page + 1;

    if (nextPage > totalPages) {
      nextTaskIndex++;
      nextPage = 1;
    }

    const done = nextTaskIndex >= tasks.length;

    if (done) {
      await logCompletion(req, supabase, stats, startStr, endStr, lookbackDays);
    }

    return jsonResp({
      done,
      cursor: done ? null : { taskIndex: nextTaskIndex, page: nextPage, stats },
      progress: buildProgress(taskIndex, tasks.length, page, totalPages, stats, totalRegistros),
      stats,
    });
  } catch (err) {
    console.error('inventory-consumption-sync error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function buildProgress(taskIndex: number, totalTasks: number, page: number, totalPages: number, stats: any, totalRegistros?: number) {
  return {
    taskIndex,
    totalTasks,
    page,
    totalPages,
    totalRegistros: totalRegistros || 0,
    ...stats,
  };
}

const GC_API_USER_NAME = 'Usuário API GC (guilherme.pedrosa@outlook.com)';

async function logCompletion(req: Request, supabase: any, stats: any, startStr: string, endStr: string, lookbackDays: number) {
  let operatorId = 'system';
  let operatorName = `Sincronização automática · ${GC_API_USER_NAME}`;
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
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
    action: 'Sincronização de consumo concluída',
    details: {
      ...stats,
      period: `${startStr} → ${endStr}`,
      lookback_days: lookbackDays,
      gc_usuario_id: GC_API_USER_ID,
    },
  });

}

async function processDocumentPage(
  docType: 'venda' | 'os',
  docs: any[],
  fallbackSituacaoIds: string[],
  supabase: any,
  stats: any,
) {
  if (docs.length === 0) return;

  const now = new Date().toISOString();
  const docIds = docs.map((doc) => String(doc.id)).filter(Boolean);
  const partialSourceKeys = docIds.map((docId) => `${docType}:${docId}`);
  const [
    { data: partialRows, error: partialErr },
    { data: partialOperationRows, error: partialOperationErr },
    { data: effectRows, error: effectErr },
  ] = await Promise.all([
    supabase
      .from('partial_writeoff_batches')
      .select('id, auxiliary_document_id')
      .eq('auxiliary_document_type', docType)
      .in('auxiliary_document_id', docIds),
    supabase
      .from('partial_writeoff_operations')
      .select('budget_id, status')
      .in('budget_id', partialSourceKeys)
      .not('status', 'in', '("completed","cancelled")'),
    supabase
      .from('doc_stock_effect')
      .select('id, doc_id, debited, first_seen_at')
      .eq('doc_type', docType)
      .in('doc_id', docIds),
  ]);
  if (partialErr) throw partialErr;
  if (partialOperationErr) throw partialOperationErr;
  if (effectErr) throw effectErr;

  const partialIds = new Set((partialRows || []).map((row: any) => String(row.auxiliary_document_id)));
  const partialSourceIds = activePartialWriteoffSourceIds(partialOperationRows || [], docType);
  const effects = new Map((effectRows || []).map((row: any) => [String(row.doc_id), row]));
  const events: any[] = [];
  const effectsToUpsert: any[] = [];
  const debitDocIds: string[] = [];
  const reverseDocIds: string[] = [];
  const reverseEffectIds: string[] = [];
  const touchEffectIds: string[] = [];

  for (const doc of docs) {
    const docId = String(doc.id);
    const situacaoId = String(doc.situacao_id || '');
    const existing: any = effects.get(docId);

    if (partialIds.has(docId)) {
      stats.skipped++;
      continue;
    }

    // A venda/OS original de uma baixa parcial ativa nao pode entrar inteira:
    // durante essa fase somente as quantidades confirmadas no Pick & Pack sao
    // materializadas. Ao concluir/cancelar a operacao, a origem volta ao fluxo
    // normal e passa a refletir sua situacao atual no GestaoClick.
    if (partialSourceIds.has(docId)) {
      stats.skipped++;
      stats.partial_sources_suppressed = (stats.partial_sources_suppressed || 0) + 1;
      // Limpa mesmo quando o espelho de efeito estiver ausente/inconsistente:
      // eventos antigos nao podem sobreviver e duplicar os batches confirmados.
      reverseDocIds.push(docId);
      if (existing?.id) reverseEffectIds.push(existing.id);
      continue;
    }

    const shouldCountConsumption = shouldCountInventoryConsumption(
      doc.situacao_estoque,
      situacaoId,
      fallbackSituacaoIds,
    );
    if (!shouldCountConsumption) {
      if (existing?.debited) {
        reverseDocIds.push(docId);
        reverseEffectIds.push(existing.id);
      } else {
        stats.skipped++;
      }
      continue;
    }

    if (existing?.debited) {
      stats.skipped++;
      touchEffectIds.push(existing.id);
      continue;
    }

    const items = (doc.produtos || [])
      .map((row: any) => row.produto || row)
      .map((prod: any) => ({
        produto_id: String(prod.produto_id || ''),
        variacao_id: prod.variacao_id ? String(prod.variacao_id) : null,
        qty: parseFloat(String(prod.quantidade || 0)),
        raw: prod,
      }))
      .filter((item: any) => item.produto_id && item.qty > 0);
    if (items.length === 0) continue;

    const occurredAt = getDocumentOccurredAt(docType, doc, now);
    const clienteNome = doc.nome_cliente || doc.cliente?.nome || null;
    for (const item of items) {
      events.push({
        occurred_at: occurredAt,
        source_type: docType,
        source_id: docId,
        situacao_id: situacaoId,
        produto_id: item.produto_id,
        variacao_id: item.variacao_id,
        qty: item.qty,
        valor_custo: item.raw.valor_custo ? parseFloat(String(item.raw.valor_custo)) : null,
        raw: item.raw,
        cliente_nome: clienteNome,
      });
    }

    debitDocIds.push(docId);
    effectsToUpsert.push({
      doc_type: docType,
      doc_id: docId,
      debited: true,
      debited_at: now,
      debit_situacao_id: situacaoId,
      first_seen_at: existing?.first_seen_at || now,
      last_seen_at: now,
    });
    stats.pecas_created += items.length;
    if (docType === 'os') stats.os_debited++;
    else stats.vendas_debited++;
  }

  if (reverseDocIds.length > 0) {
    const { data: removed, error: removeErr } = await supabase
      .from('inventory_consumption_events')
      .delete()
      .eq('source_type', docType)
      .in('source_id', reverseDocIds)
      .select('id');
    if (removeErr) throw removeErr;
    if (reverseEffectIds.length > 0) {
      const { error: reverseErr } = await supabase
        .from('doc_stock_effect')
        .update({ debited: false, last_seen_at: now })
        .in('id', reverseEffectIds);
      if (reverseErr) throw reverseErr;
    }
    stats.reversed = (stats.reversed || 0) + reverseDocIds.length;
    stats.events_removed = (stats.events_removed || 0) + (removed?.length || 0);
  }

  if (touchEffectIds.length > 0) {
    const { error: touchErr } = await supabase
      .from('doc_stock_effect')
      .update({ last_seen_at: now })
      .in('id', touchEffectIds);
    if (touchErr) throw touchErr;
  }

  if (debitDocIds.length > 0) {
    const { error: cleanupErr } = await supabase
      .from('inventory_consumption_events')
      .delete()
      .eq('source_type', docType)
      .in('source_id', debitDocIds);
    if (cleanupErr) throw cleanupErr;

    for (let i = 0; i < events.length; i += 500) {
      const { error: insertErr } = await supabase
        .from('inventory_consumption_events')
        .insert(events.slice(i, i + 500));
      if (insertErr) throw insertErr;
    }

    const { error: effectUpsertErr } = await supabase
      .from('doc_stock_effect')
      .upsert(effectsToUpsert, { onConflict: 'doc_type,doc_id' });
    if (effectUpsertErr) throw effectUpsertErr;
  }
}

function getDocumentOccurredAt(docType: 'venda' | 'os', doc: any, fallback: string): string {
  if (docType === 'os') {
    const obs = doc.observacoes || '';
    const checkoutMatch = obs.match(/\[WeDo Checkout\] Separação .* em (\d{2}\/\d{2}\/\d{4})/);
    if (checkoutMatch) {
      const [d, m, y] = checkoutMatch[1].split('/');
      return new Date(`${y}-${m}-${d}T12:00:00Z`).toISOString();
    }
    return doc.data_saida || doc.modificado_em || doc.data_entrada || doc.data || fallback;
  }

  return doc.modificado_em || doc.data || fallback;
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
  return d.toISOString().split('T')[0];
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
