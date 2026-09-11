import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { consolidateExecutedOs } from '../_shared/partialConsolidation.ts';
import { executionDocument } from '../_shared/partialExecution.ts';

// Executado pelo cron, inclusive com todos os navegadores fechados.
Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cloud = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
  const { data: authorized, error: authError } = await cloud.rpc('partial_execution_authorized', { p_token: req.headers.get('x-internal-token') || '' });
  if (authError || authorized !== true) return new Response('Unauthorized', { status: 401 });
  const rpc = async (name: string, payload: Record<string, unknown>) => {
    const { data, error } = await cloud.rpc(name, payload);
    if (error) throw error;
    return data;
  };
  const gc = async (path: string, method = 'GET', payload?: unknown) => {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/gc-proxy`, {
      method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path, method, payload }), signal: AbortSignal.timeout(25000),
    });
    const body = await response.json();
    if (!response.ok || !body?._proxy?.ok) throw new Error(`GC ${method} ${path}: ${body?._proxy?.gc_http_status || response.status}`);
    return body;
  };
  try {
    const { data: operations, error } = await cloud.from('partial_writeoff_operations').select('id')
      .eq('document_type', 'os').in('status', ['awaiting_execution', 'ready_to_consolidate']).order('updated_at').limit(10);
    if (error) throw error;
    const results: unknown[] = [];
    for (const row of operations || []) {
      try {
        const reload = async () => {
          const { data, error } = await cloud.from('partial_writeoff_operations')
            .select('*, batches:partial_writeoff_batches(*)').eq('id', row.id).single();
          if (error) throw error;
          data.batches.sort((a: any, b: any) => a.sequence - b.sequence);
          return data;
        };
        const op = await reload();
        const documents = [];
        for (const b of op.batches.filter((b: any) => b.confirmed_at && b.auxiliary_document_id)) {
          const doc = (await gc(`/api/ordens_servicos/${b.auxiliary_document_id}`)).data;
          if (String(doc?.id) !== b.auxiliary_document_id) throw new Error('OS inválida na verificação da execução.');
          documents.push(executionDocument(b.id, doc));
        }
        const status = await rpc('partial_writeoff_record_execution', { p_operation_id: op.id, p_documents: documents });
        if (status === 'ready_to_consolidate') {
          await consolidateExecutedOs(await reload(), { gc, rpc, reload, settings: async () => {
            const { data, error } = await cloud.from('partial_writeoff_settings').select('*').eq('singleton', true).single();
            if (error) throw error;
            return data;
          } });
        }
        results.push({ id: op.id, status: (await reload()).status });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('partial-execution-worker', row.id, message);
        await cloud.from('partial_writeoff_events').insert({ operation_id: row.id, event_type: 'automatic_execution_check_failed', payload: { message } });
        results.push({ id: row.id, error: message });
      }
    }
    return Response.json({ ok: true, results });
  } catch (error) {
    console.error('partial-execution-worker', error);
    return Response.json({ ok: false, error: 'EXECUTION_WORKER_FAILED' }, { status: 500 });
  }
});
