import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AUVO_API_URL = 'https://api.auvo.com.br/v2';
const GC_API_URL = 'https://api.gestaoclick.com';
const GC_API_USER_ID = '1320473';

function digits(v: unknown) { return String(v ?? '').replace(/\D+/g, ''); }

async function auvoLogin(): Promise<string> {
  const apiKey = Deno.env.get('AUVO_API_KEY');
  const apiToken = Deno.env.get('AUVO_API_TOKEN');
  if (!apiKey || !apiToken) throw new Error('Auvo credentials not configured');
  const res = await fetch(`${AUVO_API_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`);
  const data = await res.json();
  if (!data?.result?.accessToken) throw new Error('Auvo login failed');
  return data.result.accessToken;
}

async function auvoGet(token: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${AUVO_API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.result ?? data;
  } catch {
    return null;
  }
}

async function gcGet(path: string): Promise<any | null> {
  const access = Deno.env.get('GC_ACCESS_TOKEN');
  const secret = Deno.env.get('GC_SECRET_TOKEN');
  if (!access || !secret) throw new Error('GC credentials not configured');
  const url = new URL(`${GC_API_URL}${path}`);
  if (!url.searchParams.has('usuario_id')) url.searchParams.set('usuario_id', GC_API_USER_ID);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'access-token': access, 'secret-access-token': secret, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

interface LinkAgg {
  gc_cliente_id: string;
  gc_cliente_nome: string;
  cnpj_normalizado: string | null;
  auvo_customer_id: string;
  auvo_customer_name: string;
  usage_count: number;
  first_at: string;
  first_orcamento_id: string;
  first_orcamento_codigo: string;
  first_user_id: string | null;
  first_user_name: string | null;
  last_at: string;
  last_orcamento_id: string;
  last_orcamento_codigo: string;
  last_user_id: string | null;
  last_user_name: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Only authenticated users may run the backfill.
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: userData } = await supabase.auth.getUser(jwt);
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 120, 1), 300);
    const offset = Math.max(Number(body?.offset) || 0, 0);

    const { count } = await supabase
      .from('os_generation_logs')
      .select('id', { count: 'exact', head: true })
      .eq('success', true)
      .not('auvo_task_id', 'is', null);

    const { data: logs, error: logsError } = await supabase
      .from('os_generation_logs')
      .select('orcamento_id, orcamento_codigo, nome_cliente, auvo_task_id, operator_id, operator_name, created_at')
      .eq('success', true)
      .not('auvo_task_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (logsError) throw logsError;

    const token = await auvoLogin();
    const taskCache = new Map<string, string>();     // taskId -> auvo customerId
    const custCache = new Map<string, string>();     // auvo customerId -> name
    const orcCache = new Map<string, { clienteId: string; nome: string }>();
    const clienteCache = new Map<string, { nome: string; cnpj: string }>();

    const aggregates = new Map<string, LinkAgg>();
    let processed = 0;
    let skipped = 0;

    for (const log of (logs || []) as any[]) {
      const taskId = String(log.auvo_task_id || '').trim();
      const orcId = String(log.orcamento_id || '').trim();
      if (!taskId || !orcId) { skipped++; continue; }

      // Auvo task -> customer id
      let auvoCustomerId = taskCache.get(taskId);
      if (auvoCustomerId === undefined) {
        const task = await auvoGet(token, `/tasks/${encodeURIComponent(taskId)}`);
        auvoCustomerId = String(task?.customerId ?? task?.customerID ?? '');
        taskCache.set(taskId, auvoCustomerId);
      }
      if (!auvoCustomerId) { skipped++; continue; }

      // GC orçamento -> cliente id
      let orc = orcCache.get(orcId);
      if (!orc) {
        const res = await gcGet(`/api/orcamentos/${encodeURIComponent(orcId)}`);
        const d = res?.data;
        orc = { clienteId: String(d?.cliente_id ?? ''), nome: String(d?.nome_cliente ?? log.nome_cliente ?? '') };
        orcCache.set(orcId, orc);
      }
      if (!orc.clienteId) { skipped++; continue; }

      // GC cliente -> nome/cnpj
      let cliente = clienteCache.get(orc.clienteId);
      if (!cliente) {
        const res = await gcGet(`/api/clientes/${encodeURIComponent(orc.clienteId)}`);
        const c = res?.data;
        cliente = {
          nome: String(c?.nome ?? c?.razao_social ?? orc.nome ?? ''),
          cnpj: digits(c?.cnpj ?? c?.cpf ?? c?.cpf_cnpj ?? ''),
        };
        clienteCache.set(orc.clienteId, cliente);
      }

      // Auvo customer name
      let auvoName = custCache.get(auvoCustomerId);
      if (auvoName === undefined) {
        const c = await auvoGet(token, `/customers/${encodeURIComponent(auvoCustomerId)}`);
        auvoName = String(c?.description ?? c?.customerName ?? c?.name ?? '');
        custCache.set(auvoCustomerId, auvoName);
      }

      const key = `${orc.clienteId}::${auvoCustomerId}`;
      const at = String(log.created_at);
      const current = aggregates.get(key);
      if (!current) {
        aggregates.set(key, {
          gc_cliente_id: orc.clienteId,
          gc_cliente_nome: cliente.nome || orc.nome || String(log.nome_cliente || ''),
          cnpj_normalizado: cliente.cnpj || null,
          auvo_customer_id: auvoCustomerId,
          auvo_customer_name: auvoName || '',
          usage_count: 1,
          first_at: at,
          first_orcamento_id: orcId,
          first_orcamento_codigo: String(log.orcamento_codigo || ''),
          first_user_id: log.operator_id || null,
          first_user_name: log.operator_name || null,
          last_at: at,
          last_orcamento_id: orcId,
          last_orcamento_codigo: String(log.orcamento_codigo || ''),
          last_user_id: log.operator_id || null,
          last_user_name: log.operator_name || null,
        });
      } else {
        current.usage_count += 1;
        if (at >= current.last_at) {
          current.last_at = at;
          current.last_orcamento_id = orcId;
          current.last_orcamento_codigo = String(log.orcamento_codigo || '');
          current.last_user_id = log.operator_id || null;
          current.last_user_name = log.operator_name || null;
        }
      }
      processed++;
    }

    let inserted = 0;
    let updated = 0;

    for (const agg of aggregates.values()) {
      const { data: existing } = await supabase
        .from('auvo_customer_links')
        .select('id, usage_count, created_at, last_used_at')
        .eq('gc_cliente_id', agg.gc_cliente_id)
        .eq('auvo_customer_id', agg.auvo_customer_id)
        .maybeSingle();

      if (existing?.id) {
        const patch: Record<string, unknown> = {
          usage_count: Number((existing as any).usage_count || 0) + agg.usage_count,
          gc_cliente_nome: agg.gc_cliente_nome,
          cnpj_normalizado: agg.cnpj_normalizado,
          auvo_customer_name: agg.auvo_customer_name || undefined,
        };
        if (agg.last_at > String((existing as any).last_used_at)) {
          patch.last_used_at = agg.last_at;
          patch.last_orcamento_id = agg.last_orcamento_id;
          patch.last_orcamento_codigo = agg.last_orcamento_codigo;
          patch.last_used_by = agg.last_user_id;
          patch.last_used_by_name = agg.last_user_name;
        }
        if (agg.first_at < String((existing as any).created_at)) {
          patch.created_at = agg.first_at;
          patch.orcamento_id = agg.first_orcamento_id;
          patch.orcamento_codigo = agg.first_orcamento_codigo;
          patch.created_by = agg.first_user_id;
          patch.created_by_name = agg.first_user_name;
        }
        await supabase.from('auvo_customer_links').update(patch).eq('id', (existing as any).id);
        updated++;
      } else {
        await supabase.from('auvo_customer_links').insert({
          gc_cliente_id: agg.gc_cliente_id,
          gc_cliente_nome: agg.gc_cliente_nome,
          cnpj_normalizado: agg.cnpj_normalizado,
          auvo_customer_id: agg.auvo_customer_id,
          auvo_customer_name: agg.auvo_customer_name || '',
          usage_count: agg.usage_count,
          created_at: agg.first_at,
          orcamento_id: agg.first_orcamento_id,
          orcamento_codigo: agg.first_orcamento_codigo,
          created_by: agg.first_user_id,
          created_by_name: agg.first_user_name,
          last_used_at: agg.last_at,
          last_orcamento_id: agg.last_orcamento_id,
          last_orcamento_codigo: agg.last_orcamento_codigo,
          last_used_by: agg.last_user_id,
          last_used_by_name: agg.last_user_name,
        });
        inserted++;
      }
    }

    const nextOffset = offset + (logs?.length || 0);
    return new Response(JSON.stringify({
      total_logs: count ?? null,
      processed,
      skipped,
      links_inserted: inserted,
      links_updated: updated,
      next_offset: nextOffset,
      done: !logs || logs.length < limit,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[auvo-links-backfill]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
