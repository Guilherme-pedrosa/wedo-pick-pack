const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GC_API_URL = 'https://api.gestaoclick.com';

// Config from user's screenshot — budget statuses to scan
const BUDGET_STATUS_NAMES = [
  'APROVADO - AGUARDANDO COMPRA',
  'COMPRADO - AGUARDANDO CHEGADA',
  'COMPRADO - AG CHEGADA PARA ESTOQUE',
];

// Purchase order statuses for cross-reference (from screenshot)
const PURCHASE_CROSSREF_NAMES = [
  'Em Cotação',
  'Aguardando Aprovação',
  'Aprovada - AG COMPRA',
  'COMPRADO - AG CHEGADA',
  'SOLICITADO - GARANTIA',
  'COMPRADO - AG CHEGADA PARA ESTOQUE',
];

// OS statuses that reserve stock but don't move it
const OS_RESERVED_STATUS_NAMES = [
  'AGUARDANDO COMPRA DE PECAS',
  'AGUARDANDO CHEGADA DE PECAS',
  'AGUARDANDO FABRICACAO',
  'PEDIDO EM CONFERENCIA',
  'SERVICO AGUARDANDO EXECUCAO',
];

interface GCMeta { pagina_atual: number; total_paginas: number; total_registros: number; }

function normalizeForMatch(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function normalizeId(v: string | number | null | undefined): string {
  if (v == null) return '';
  const raw = String(v).trim();
  if (!raw || raw === '0' || raw === 'null' || raw === 'undefined') return '';
  return raw;
}

function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  if (raw.includes(',')) return parseFloat(raw.replace(',', '.')) || 0;
  return parseFloat(raw) || 0;
}

function makeProdutoKey(produtoId: string, variacaoId: string): string {
  const pid = normalizeId(produtoId);
  const vid = normalizeId(variacaoId);
  return vid ? `${pid}::${vid}` : pid;
}

function isConvertedBudgetFlag(value: unknown): boolean {
  const n = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!n) return false;
  if (/^\d+$/.test(n)) return Number(n) > 0;
  return n === 'true' || n === 'sim' || n === 'yes';
}

async function gcFetch(path: string, accessToken: string, secretToken: string): Promise<any> {
  const res = await fetch(`${GC_API_URL}${path}`, {
    headers: {
      'access-token': accessToken,
      'secret-access-token': secretToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  const body = await res.json();
  if (!res.ok) throw new Error(body?.data?.mensagem || `GC API ${res.status}`);
  return body;
}

async function fetchAllPages(basePath: string, at: string, st: string, delayMs = 400): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const sep = basePath.includes('?') ? '&' : '?';
    const res = await gcFetch(`${basePath}${sep}limite=100&pagina=${page}`, at, st);
    totalPages = res?.meta?.total_paginas || 1;
    all.push(...(res?.data || []));
    page++;
    if (page <= totalPages) await new Promise(r => setTimeout(r, delayMs));
  }
  return all;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const AT = Deno.env.get('GC_ACCESS_TOKEN')!;
  const ST = Deno.env.get('GC_SECRET_TOKEN')!;
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!AT || !ST) {
    return new Response(JSON.stringify({ error: 'GC credentials missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('[COMPRAS-AUTO] Starting automated scan...');

    // Step 1: Resolve budget status IDs by name
    const statusOrcRes = await gcFetch('/api/situacoes_orcamentos', AT, ST);
    const allBudgetStatuses: { id: string; nome: string }[] = statusOrcRes?.data || [];
    const budgetStatusIds = allBudgetStatuses
      .filter(s => BUDGET_STATUS_NAMES.some(n => normalizeForMatch(n) === normalizeForMatch(s.nome)))
      .map(s => s.id);
    console.log(`[COMPRAS-AUTO] Budget statuses matched: ${budgetStatusIds.length}`);

    if (budgetStatusIds.length === 0) {
      throw new Error('No matching budget statuses found');
    }

    // Step 2: Resolve purchase order status IDs
    const statusCompraRes = await gcFetch('/api/situacoes_compras', AT, ST);
    const allPurchaseStatuses: { id: string; nome: string }[] = statusCompraRes?.data || [];
    const purchaseStatusIds = allPurchaseStatuses
      .filter(s => PURCHASE_CROSSREF_NAMES.some(n => normalizeForMatch(n) === normalizeForMatch(s.nome)))
      .map(s => s.id);
    console.log(`[COMPRAS-AUTO] Purchase statuses matched: ${purchaseStatusIds.length}`);

    // Step 3: Fetch all approved budgets
    const budgetStatusSet = new Set(budgetStatusIds);
    const allBudgets: any[] = [];
    for (const sid of budgetStatusIds) {
      const raw = await fetchAllPages(`/api/orcamentos?situacao_id=${sid}`, AT, ST);
      const filtered = raw.filter((o: any) => budgetStatusSet.has(String(o.situacao_id)));
      allBudgets.push(...filtered);
    }
    console.log(`[COMPRAS-AUTO] Fetched ${allBudgets.length} budgets`);

    // Step 4: Build OS index (budget→OS links + reserved demand)
    const osIndex: Record<string, { os_codigo: string; os_id: string; nome_situacao: string }> = {};
    const reservedDemand: Record<string, { qty: number; orcamentos: Array<{ os_codigo: string; nome_cliente: string; qtd: number }> }> = {};
    const allOS = await fetchAllPages('/api/ordens_servicos', AT, ST, 350);
    
    for (const item of allOS) {
      const os = item?.OrdemServico ?? item?.ordem_servico ?? item?.ordemServico ?? item;
      const osCodigo = normalizeId(os?.codigo) || normalizeId(os?.numero) || normalizeId(os?.id) || '—';
      const osId = normalizeId(os?.id);
      const nomeSituacao = String(os?.nome_situacao ?? '');
      const nomeCliente = String(os?.nome_cliente ?? '');
      const normalizedSituacao = normalizeForMatch(nomeSituacao);

      // Budget→OS links
      for (const wrapper of os?.atributos || []) {
        const atributo = wrapper?.atributo;
        if (!atributo) continue;
        const desc = normalizeForMatch(String(atributo.descricao ?? ''));
        if (!desc.includes('ORCAMENTO') && !desc.includes('NUMERO ORC')) continue;
        const conteudo = String(atributo.conteudo ?? '').trim();
        if (!conteudo || !/^\d+$/.test(conteudo)) continue;
        osIndex[conteudo] = { os_codigo: osCodigo, os_id: osId, nome_situacao: nomeSituacao };
      }

      // Reserved demand from pending OS
      if (OS_RESERVED_STATUS_NAMES.includes(normalizedSituacao)) {
        for (const wrapper of os?.produtos || []) {
          const p = wrapper?.produto;
          if (!p) continue;
          const pid = normalizeId(p.produto_id);
          if (!pid) continue;
          const vid = normalizeId(p.variacao_id);
          const key = vid ? `${pid}::${vid}` : pid;
          const qtd = parseDecimal(p.quantidade);
          if (qtd <= 0) continue;
          if (!reservedDemand[key]) reservedDemand[key] = { qty: 0, orcamentos: [] };
          reservedDemand[key].qty += qtd;
          reservedDemand[key].orcamentos.push({ os_codigo: osCodigo, nome_cliente: nomeCliente, qtd });
        }
      }
    }
    console.log(`[COMPRAS-AUTO] OS index: ${Object.keys(osIndex).length} links, ${Object.keys(reservedDemand).length} reserved products`);

    // Step 5: Filter out converted budgets
    const eligibleBudgets = allBudgets.filter(o => {
      const byFlags = isConvertedBudgetFlag(o.situacao_financeiro) || isConvertedBudgetFlag(o.situacao_estoque);
      const osMatch = osIndex[String(o.codigo)];
      return !byFlags && !osMatch;
    });
    const convertedCount = allBudgets.length - eligibleBudgets.length;
    console.log(`[COMPRAS-AUTO] ${eligibleBudgets.length} eligible, ${convertedCount} converted`);

    // Step 6: Fetch purchase orders for cross-reference
    const allPurchaseOrders: any[] = [];
    for (const sid of purchaseStatusIds) {
      const raw = await fetchAllPages(`/api/compras?situacao_id=${sid}`, AT, ST);
      for (const row of raw) {
        const compra = row?.Compra ?? row;
        allPurchaseOrders.push(compra);
      }
    }

    // Build purchase map
    const compraMap = new Map<string, { qtd: number }>();
    const compraMapByProduto = new Map<string, { qtd: number }>();
    for (const ordem of allPurchaseOrders) {
      for (const p of ordem?.produtos || []) {
        const prod = p?.produto;
        const produtoId = normalizeId(prod?.produto_id);
        if (!produtoId) continue;
        const key = makeProdutoKey(produtoId, prod?.variacao_id ?? prod?.estoque_id);
        const qty = parseDecimal(prod?.quantidade);
        if (!compraMap.has(key)) compraMap.set(key, { qtd: 0 });
        compraMap.get(key)!.qtd += qty;
        if (!compraMapByProduto.has(produtoId)) compraMapByProduto.set(produtoId, { qtd: 0 });
        compraMapByProduto.get(produtoId)!.qtd += qty;
      }
    }

    // Step 7: Aggregate product quantities from eligible budgets
    const productMap = new Map<string, {
      produto_id: string; variacao_id: string; nome_produto: string;
      codigo_produto: string; sigla_unidade: string;
      qtd_total: number;
      orcamentos: Array<{ codigo: string; qtd: number; nome_cliente: string }>;
    }>();

    for (const orc of eligibleBudgets) {
      for (const p of orc.produtos || []) {
        const prod = p?.produto;
        const produtoId = normalizeId(prod?.produto_id);
        if (!produtoId) continue;
        const variacaoId = normalizeId(prod?.variacao_id);
        const key = makeProdutoKey(produtoId, variacaoId);
        const qty = parseDecimal(prod?.quantidade);
        if (!productMap.has(key)) {
          productMap.set(key, {
            produto_id: produtoId, variacao_id: variacaoId,
            nome_produto: String(prod?.nome_produto ?? ''),
            codigo_produto: String(prod?.codigo_produto ?? ''),
            sigla_unidade: String(prod?.sigla_unidade ?? 'UN'),
            qtd_total: 0, orcamentos: [],
          });
        }
        const entry = productMap.get(key)!;
        entry.qtd_total += qty;
        entry.orcamentos.push({ codigo: orc.codigo, qtd: qty, nome_cliente: orc.nome_cliente });
      }
    }

    // Step 8: Fetch stock for each product
    const detailCache = new Map<string, any>();
    const uniqueKeys = [...productMap.keys()];

    for (let i = 0; i < uniqueKeys.length; i += 2) {
      const batch = uniqueKeys.slice(i, i + 2);
      await Promise.all(batch.map(async key => {
        const entry = productMap.get(key)!;
        if (detailCache.has(entry.produto_id)) return;
        try {
          const res = await gcFetch(`/api/produtos/${entry.produto_id}`, AT, ST);
          const raw = res?.data?.Produto ?? res?.data?.produto ?? res?.data;
          detailCache.set(entry.produto_id, raw || null);
        } catch {
          detailCache.set(entry.produto_id, null);
        }
      }));
      if (i + 2 < uniqueKeys.length) await new Promise(r => setTimeout(r, 500));
    }

    // Step 9: Build items list
    interface ItemResult {
      produto_id: string;
      variacao_id: string;
      nome_produto: string;
      codigo_produto: string;
      sigla_unidade: string;
      grupo?: string;
      estoque_atual: number;
      estoque_reservado_os: number;
      estoque_disponivel: number;
      qtd_necessaria: number;
      qtd_a_comprar: number;
      qtd_ja_em_compra: number;
      qtd_efetiva_a_comprar: number;
      ultimo_preco: number;
      estimativa: number;
      orcamentos: Array<{ codigo: string; qtd: number; nome_cliente: string }>;
    }

    const allItems: ItemResult[] = [];

    for (const [key, entry] of productMap) {
      const detail = detailCache.get(entry.produto_id);
      let estoqueAtual = 0;
      let valorCusto = 0;

      if (detail) {
        if (entry.variacao_id && detail.variacoes?.length) {
          const v = detail.variacoes.find((v: any) => String(v?.variacao?.id) === String(entry.variacao_id));
          estoqueAtual = v ? parseDecimal(v.variacao.estoque) : parseDecimal(detail.estoque);
        } else {
          estoqueAtual = parseDecimal(detail.estoque);
        }
        valorCusto = parseDecimal(detail.valor_custo);
      }

      const fullKey = makeProdutoKey(entry.produto_id, entry.variacao_id);
      const reservaEntry = reservedDemand[fullKey] ?? reservedDemand[entry.produto_id];
      const estoqueReservadoOS = reservaEntry?.qty ?? 0;
      const estoqueDisponivel = Math.max(0, estoqueAtual - estoqueReservadoOS);

      const compraEntry = compraMap.get(fullKey) ?? compraMapByProduto.get(entry.produto_id);
      const qtdJaEmCompra = compraEntry?.qtd ?? 0;

      const deficit = Math.max(0, entry.qtd_total - estoqueDisponivel);
      const qtdEfetivaAComprar = Math.max(0, deficit - qtdJaEmCompra);
      const estimativa = qtdEfetivaAComprar * valorCusto;

      const grupo = String(detail?.nome_grupo ?? detail?.grupo_nome ?? detail?.grupo?.nome ?? '').trim() || undefined;

      allItems.push({
        produto_id: entry.produto_id,
        variacao_id: entry.variacao_id,
        nome_produto: detail?.nome || entry.nome_produto,
        codigo_produto: detail?.codigo_interno || entry.codigo_produto,
        sigla_unidade: entry.sigla_unidade,
        grupo,
        estoque_atual: estoqueAtual,
        estoque_reservado_os: estoqueReservadoOS,
        estoque_disponivel: estoqueDisponivel,
        qtd_necessaria: entry.qtd_total,
        qtd_a_comprar: deficit,
        qtd_ja_em_compra: qtdJaEmCompra,
        qtd_efetiva_a_comprar: qtdEfetivaAComprar,
        ultimo_preco: valorCusto,
        estimativa,
        orcamentos: entry.orcamentos,
      });
    }

    // Also check OS-only deficits
    const processedKeys = new Set(productMap.keys());
    for (const [key, reserva] of Object.entries(reservedDemand)) {
      if (processedKeys.has(key)) continue;
      const parts = key.split('::');
      const produtoId = parts[0];
      const variacaoId = parts[1] || '';

      if (!detailCache.has(produtoId)) {
        try {
          const res = await gcFetch(`/api/produtos/${produtoId}`, AT, ST);
          const raw = res?.data?.Produto ?? res?.data?.produto ?? res?.data;
          detailCache.set(produtoId, raw || null);
        } catch {
          detailCache.set(produtoId, null);
        }
        await new Promise(r => setTimeout(r, 500));
      }
      const detail = detailCache.get(produtoId);
      let estoqueAtual = 0;
      let valorCusto = 0;
      if (detail) {
        if (variacaoId && detail.variacoes?.length) {
          const v = detail.variacoes.find((v: any) => String(v?.variacao?.id) === variacaoId);
          estoqueAtual = v ? parseDecimal(v.variacao.estoque) : parseDecimal(detail.estoque);
        } else {
          estoqueAtual = parseDecimal(detail.estoque);
        }
        valorCusto = parseDecimal(detail.valor_custo);
      }

      const deficit = reserva.qty - estoqueAtual;
      if (deficit > 0) {
        const compraEntry = compraMap.get(key) ?? compraMapByProduto.get(produtoId);
        const qtdJaEmCompra = compraEntry?.qtd ?? 0;
        const qtdEfetivaAComprar = Math.max(0, deficit - qtdJaEmCompra);

        allItems.push({
          produto_id: produtoId,
          variacao_id: variacaoId,
          nome_produto: detail?.nome || `Produto ${produtoId}`,
          codigo_produto: detail?.codigo_interno || '',
          sigla_unidade: 'UN',
          grupo: String(detail?.nome_grupo ?? '').trim() || undefined,
          estoque_atual: estoqueAtual,
          estoque_reservado_os: reserva.qty,
          estoque_disponivel: 0,
          qtd_necessaria: 0,
          qtd_a_comprar: deficit,
          qtd_ja_em_compra: qtdJaEmCompra,
          qtd_efetiva_a_comprar: qtdEfetivaAComprar,
          ultimo_preco: valorCusto,
          estimativa: qtdEfetivaAComprar * valorCusto,
          orcamentos: [],
        });
      }
    }

    const itensList = allItems.filter(i => i.qtd_efetiva_a_comprar > 0);
    const itensOk = allItems.filter(i => i.qtd_a_comprar === 0);
    const itensCobertos = allItems.filter(i => i.qtd_efetiva_a_comprar === 0 && i.qtd_a_comprar > 0);
    const estimativaTotal = itensList.reduce((sum, i) => sum + i.estimativa, 0);

    const durationMs = Date.now() - startTime;
    console.log(`[COMPRAS-AUTO] Done in ${durationMs}ms: ${itensList.length} items to buy`);

    // Step 10: Save snapshot to DB
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { error: insertError } = await supabase.from('compras_snapshots').insert({
      total_produtos_sem_estoque: itensList.length,
      total_produtos_ok: itensOk.length,
      total_itens_cobertos_pedido: itensCobertos.length,
      total_orcamentos: eligibleBudgets.length,
      estimativa_total: estimativaTotal,
      orcamentos_convertidos_count: convertedCount,
      itens_list: itensList,
      config_used: {
        budget_statuses: BUDGET_STATUS_NAMES,
        purchase_statuses: PURCHASE_CROSSREF_NAMES,
        budget_status_ids: budgetStatusIds,
        purchase_status_ids: purchaseStatusIds,
      },
      status: 'success',
      duration_ms: durationMs,
    });

    if (insertError) {
      console.error('[COMPRAS-AUTO] Insert error:', insertError);
      throw new Error(`Failed to save snapshot: ${insertError.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      total_itens_comprar: itensList.length,
      total_itens_ok: itensOk.length,
      total_cobertos: itensCobertos.length,
      estimativa_total: estimativaTotal,
      duration_ms: durationMs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[COMPRAS-AUTO] Error:', message);

    // Save error snapshot
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      await supabase.from('compras_snapshots').insert({
        status: 'error',
        error_message: message,
        duration_ms: Date.now() - startTime,
      });
    } catch (e) {
      console.error('[COMPRAS-AUTO] Failed to save error snapshot:', e);
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
