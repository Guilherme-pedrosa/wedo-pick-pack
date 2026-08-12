// ============================================================================
// create-gc-purchase-from-suggestions
// Recebe suggestion_ids aprovados, agrupa por fornecedor e cria pedido(s) de
// compra no GestãoClick. NUNCA cria nada sem aprovação explícita (a tela só
// envia ids selecionados pelo comprador). Salva o vínculo suggestion -> compra.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  GC_API_USER_ID,
  withGcApiUser,
  withGcApiUserPayload,
} from '../_shared/gc-api-user.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const gcAccess = Deno.env.get('GC_ACCESS_TOKEN')!;
  const gcSecret = Deno.env.get('GC_SECRET_TOKEN')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!gcAccess || !gcSecret) return jsonResp({ error: 'GC credentials not configured' }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: 'Body inválido' }, 400);
  }

  const suggestionIds: string[] = Array.isArray(body?.suggestion_ids) ? body.suggestion_ids : [];
  const situacaoId: string | undefined = body?.situacao_id; // situação "em aberto" para a nova compra
  if (suggestionIds.length === 0) return jsonResp({ error: 'Nenhuma sugestão informada' }, 400);

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: rows, error } = await supabase
    .from('inventory_purchase_suggestions')
    .select('id, produto_id, nome, fornecedor_id, fornecedor_nome, valor_custo, qty_sugerida, gc_compra_id')
    .in('id', suggestionIds);
  if (error) return jsonResp({ error: 'Erro lendo sugestões: ' + error.message }, 500);

  const valid = (rows || []).filter((r: any) => Number(r.qty_sugerida) > 0 && !r.gc_compra_id);
  if (valid.length === 0) return jsonResp({ error: 'Nenhuma sugestão válida (qty > 0 e ainda não comprada)' }, 400);

  // agrupa por fornecedor (sem fornecedor → grupo "sem_fornecedor")
  const byFornecedor = new Map<string, any[]>();
  for (const r of valid as any[]) {
    const key = r.fornecedor_id || 'sem_fornecedor';
    if (!byFornecedor.has(key)) byFornecedor.set(key, []);
    byFornecedor.get(key)!.push(r);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const created: any[] = [];
  const errors: any[] = [];

  for (const [fornecedorId, items] of byFornecedor.entries()) {
    if (fornecedorId === 'sem_fornecedor') {
      errors.push({ fornecedor_id: null, error: 'Itens sem fornecedor não foram enviados', produtos: items.map((i) => i.produto_id) });
      continue;
    }

    const payload: any = {
      usuario_id: GC_API_USER_ID,
      fornecedor_id: fornecedorId,
      data_emissao: hoje,
      observacoes_interna: 'Compra gerada automaticamente pelo Pick Pack com base na análise de estoque.',
      produtos: items.map((i) => ({
        produto: {
          produto_id: i.produto_id,
          nome_produto: i.nome || '',
          quantidade: Number(i.qty_sugerida).toFixed(2),
          valor_custo: i.valor_custo != null ? Number(i.valor_custo).toFixed(2) : '0.00',
          possui_variacao: 0,
          variacao_id: '',
        },
      })),
    };
    if (situacaoId) payload.situacao_id = situacaoId;

    try {
      const res = await fetch(withGcApiUser('/api/compras', GC_API_URL), {
        method: 'POST',
        headers: {
          'access-token': gcAccess,
          'secret-access-token': gcSecret,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(withGcApiUserPayload(payload)),
      });
      const text = await res.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!res.ok || parsed?.status === 'error') {
        errors.push({ fornecedor_id: fornecedorId, error: parsed?.data?.mensagem || parsed?.error || `GC ${res.status}`, raw: parsed });
        continue;
      }

      const compraId = String(parsed?.data?.id ?? parsed?.id ?? parsed?.data?.compra_id ?? '');
      // vincula sugestões
      await supabase
        .from('inventory_purchase_suggestions')
        .update({ aprovado: true, gc_compra_id: compraId })
        .in('id', items.map((i) => i.id));

      created.push({ fornecedor_id: fornecedorId, fornecedor_nome: items[0].fornecedor_nome, compra_id: compraId, itens: items.length });
    } catch (err) {
      errors.push({ fornecedor_id: fornecedorId, error: err instanceof Error ? err.message : 'Erro' });
    }
    await sleep(1100); // respeita rate limit GC
  }

  return jsonResp({ created, errors, created_count: created.length, error_count: errors.length });
});
