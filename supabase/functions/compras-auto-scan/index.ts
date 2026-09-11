import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { scanPurchases, BUDGET_STATUS_NAMES, PURCHASE_STATUS_NAMES, PURCHASE_SCAN_VERSION } from '../_shared/purchaseScan.ts';
import { readPartialPurchaseOperations } from '../_shared/partialPurchaseOperations.ts';
import { normalizedStatus } from '../_shared/partialExecution.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const gc = async (path: string) => {
    const res = await fetch(`https://api.gestaoclick.com${path}`, { headers: {
      'access-token': Deno.env.get('GC_ACCESS_TOKEN')!, 'secret-access-token': Deno.env.get('GC_SECRET_TOKEN')!, Accept: 'application/json',
    } });
    const body = await res.json();
    if (!res.ok || body.status === 'error') throw new Error(`Consulta GC indisponível (${res.status}).`);
    return body;
  };
  try {
    const statuses = async (path: string, names: string[]) => {
      const res = await gc(path);
      if (!Array.isArray(res.data)) throw new Error('Situações do GC não informadas.');
      const ids = res.data.map((s: any) => s.Situacao || s.situacao || s)
        .filter((s: any) => names.some(n => normalizedStatus(n) === normalizedStatus(s.nome))).map((s: any) => String(s.id));
      if (!ids.length) throw new Error('Nenhuma situação configurada foi localizada.');
      return ids;
    };
    const budgetIds = await statuses('/api/situacoes_orcamentos?limite=100', BUDGET_STATUS_NAMES);
    const purchaseIds = await statuses('/api/situacoes_compras?limite=100', PURCHASE_STATUS_NAMES);
    const result = await scanPurchases({ gc, partials: () => readPartialPurchaseOperations(db) }, budgetIds, purchaseIds);
    const { error } = await db.from('compras_snapshots').insert({
      total_produtos_sem_estoque: result.totalProdutosSemEstoque, total_produtos_ok: result.totalProdutosOk,
      total_itens_cobertos_pedido: result.totalItensCobertosporPedido, total_orcamentos: result.totalOrcamentos,
      estimativa_total: result.estimativaTotal, orcamentos_convertidos_count: result.orcamentosConvertidos.length,
      itens_list: result.itensList, status: 'success', duration_ms: Date.now() - started,
      config_used: { budget_statuses: BUDGET_STATUS_NAMES, purchase_statuses: PURCHASE_STATUS_NAMES,
        budget_status_ids: budgetIds, purchase_status_ids: purchaseIds, purchase_scan_version: PURCHASE_SCAN_VERSION,
        partial_operations_included: result.partialOperationsIncluded, warnings: result.warnings },
    });
    if (error) throw error;
    return Response.json({ success: true, total_itens_comprar: result.totalProdutosSemEstoque }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[COMPRAS-AUTO]', message);
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
});
