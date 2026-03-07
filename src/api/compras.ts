import {
  GCSituacao, GCMeta, GCOrcamento, GCProdutoDetalhe, GCFornecedor,
  GCOrdemCompra, GCSituacaoCompra,
  ItemCompra, ComprasResult, OrcamentoConvertidoWarning,
} from './types';
import {
  MOCK_STATUS_ORCAMENTO, MOCK_ORCAMENTOS, MOCK_PRODUTOS_DETALHE, MOCK_FORNECEDORES,
  MOCK_STATUS_COMPRA, MOCK_ORDENS_COMPRA,
} from './mockData';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path, method, payload: options?.body ? JSON.parse(options.body) : undefined },
  });
  if (error) throw new Error(error.message || 'Erro de conexão com o servidor');
  const response = data as any;
  const proxyMeta = response?._proxy;
  const gcOk = proxyMeta?.ok;
  const gcHttpStatus = proxyMeta?.gc_http_status;
  const gcBodyStatus = response?.status;
  const gcBodyCode = response?.code;
  if (gcOk === false || gcBodyStatus === 'error' || (gcBodyCode && gcBodyCode >= 400)) {
    const gcMsg = response?.data?.mensagem || response?.data?.erro || response?.error || '';
    const statusCode = gcHttpStatus || gcBodyCode || 0;
    if (statusCode === 429) throw new Error('RATE_LIMIT');
    if (statusCode === 401 || statusCode === 403) throw new Error('AUTH_ERROR');
    throw new Error(gcMsg || `Erro ${statusCode} no GestãoClick`);
  }
  return response as T;
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  // pt-BR: 1.234,56 -> 1234.56
  if (raw.includes(',') && raw.includes('.')) {
    return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  }

  // pt-BR: 123,45 -> 123.45
  if (raw.includes(',')) {
    return parseFloat(raw.replace(',', '.')) || 0;
  }

  // en-US / plain: 1234.56
  return parseFloat(raw) || 0;
}

function isConvertedBudgetFlag(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'sim' || normalized === 'yes';
}

function normalizeId(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (lowered === '0' || lowered === 'null' || lowered === 'undefined') return '';
  return raw;
}

function makeProdutoKey(produtoId: string | number | null | undefined, variacaoId: string | number | null | undefined): string {
  const pid = normalizeId(produtoId);
  const vid = normalizeId(variacaoId);
  return vid ? `${pid}::${vid}` : pid;
}

// --- STATUS ORCAMENTOS ---
export async function getStatusOrcamentos(): Promise<GCSituacao[]> {
  if (isUsingMock()) { await mockDelay(); return [...MOCK_STATUS_ORCAMENTO]; }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_orcamentos');
  return res.data;
}

// --- LIST ORCAMENTOS ---
export async function listOrcamentos(situacaoId?: string, pagina = 1, nomeCliente?: string): Promise<{ data: GCOrcamento[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_ORCAMENTOS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    if (nomeCliente) {
      const q = nomeCliente.toLowerCase();
      data = data.filter(o => o.nome_cliente.toLowerCase().includes(q));
    }
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/orcamentos?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  if (nomeCliente) path += `&nome=${encodeURIComponent(nomeCliente)}`;
  return apiRequest<{ data: GCOrcamento[]; meta: GCMeta }>(path);
}

// --- PRODUTO DETALHE ---
export async function getProdutoDetalhe(produtoId: string): Promise<GCProdutoDetalhe | null> {
  if (isUsingMock()) { await mockDelay(); return MOCK_PRODUTOS_DETALHE[produtoId] ?? null; }
  try {
    const res = await apiRequest<{ data: GCProdutoDetalhe }>(`/api/produtos/${produtoId}`);
    return res.data;
  } catch { return null; }
}

// --- FORNECEDOR ---
export async function getFornecedor(fornecedorId: string): Promise<GCFornecedor | null> {
  if (isUsingMock()) { await mockDelay(); return MOCK_FORNECEDORES[fornecedorId] ?? null; }
  try {
    const res = await apiRequest<{ data: GCFornecedor }>(`/api/fornecedores/${fornecedorId}`);
    return res.data;
  } catch { return null; }
}

// --- STATUS COMPRAS ---
export async function getStatusCompras(): Promise<GCSituacaoCompra[]> {
  if (isUsingMock()) { await mockDelay(); return [...MOCK_STATUS_COMPRA]; }
  const res = await apiRequest<{ data: GCSituacaoCompra[] }>('/api/situacoes_compras');
  return res.data;
}

// --- LIST ORDENS COMPRA ---
export async function listOrdensCompra(situacaoId?: string, pagina = 1): Promise<{ data: GCOrdemCompra[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_ORDENS_COMPRA];
    if (situacaoId) data = data.filter(c => c.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }

  let path = `/api/compras?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;

  const raw = await apiRequest<{ data: any[]; meta: GCMeta }>(path);

  const data: GCOrdemCompra[] = (raw.data || []).map((row: any) => {
    const compra = row?.Compra ?? row;
    return {
      id: String(compra?.id ?? ''),
      codigo: String(compra?.codigo ?? ''),
      fornecedor_id: String(compra?.fornecedor_id ?? ''),
      nome_fornecedor: String(compra?.nome_fornecedor ?? ''),
      data_emissao: String(compra?.data_emissao ?? ''),
      situacao_id: String(compra?.situacao_id ?? ''),
      nome_situacao: String(compra?.nome_situacao ?? ''),
      valor_total: String(compra?.valor_total ?? '0'),
      produtos: (compra?.produtos || []).map((p: any) => ({
        produto: {
          id: String(p?.produto?.id ?? ''),
          produto_id: String(p?.produto?.produto_id ?? ''),
          variacao_id: String(p?.produto?.variacao_id ?? p?.produto?.estoque_id ?? ''),
          nome_produto: String(p?.produto?.nome_produto ?? ''),
          quantidade: p?.produto?.quantidade ?? '0',
          valor_custo: String(p?.produto?.valor_custo ?? '0'),
        },
      })),
    };
  });

  return { data, meta: raw.meta };
}

// --- MAIN ENGINE ---
export async function buildListaCompras(
  situacaoOrcIds: string[],
  situacaoCompraIds: string[],
  onProgress?: (step: string, checked: number, total: number) => void,
): Promise<ComprasResult> {

  // PHASE 1: Fetch all approved budgets
  onProgress?.('Buscando orçamentos aprovados…', 0, 1);
  const allOrcamentos: GCOrcamento[] = [];
  const situacaoOrcSet = new Set(situacaoOrcIds);
  for (const sid of situacaoOrcIds) {
    let page = 1;
    while (true) {
      const res = await listOrcamentos(sid, page);
      // Client-side filter: GestãoClick API may ignore situacao_id param
      const filtered = res.data.filter(o => situacaoOrcSet.has(String(o.situacao_id)));
      allOrcamentos.push(...filtered);
      console.log(`[COMPRAS] listOrcamentos sid=${sid} page=${page}: ${res.data.length} returned, ${filtered.length} after filter`);
      if (page >= res.meta.total_paginas) break;
      page++;
      if (!isUsingMock()) await new Promise(r => setTimeout(r, 400));
    }
  }

  // PHASE 1b: Detect converted budgets and exclude them from purchase calculation
  const convertedById = new Map<string, OrcamentoConvertidoWarning>();
  const orcamentosElegiveis = allOrcamentos.filter(o => {
    const isConverted = isConvertedBudgetFlag(o.situacao_financeiro) || isConvertedBudgetFlag(o.situacao_estoque);
    if (!isConverted) return true;

    if (!convertedById.has(o.id)) {
      convertedById.set(o.id, {
        orcamento_id: o.id,
        codigo: o.codigo,
        nome_cliente: o.nome_cliente,
        situacao_financeiro: String(o.situacao_financeiro ?? ''),
        situacao_estoque: String(o.situacao_estoque ?? ''),
      });
    }
    return false;
  });

  const orcamentosConvertidos = [...convertedById.values()];

  if (orcamentosConvertidos.length > 0) {
    console.log(`[COMPRAS] Phase 1b: ${orcamentosConvertidos.length} orçamento(s) já convertido(s) e removido(s) da lista de compras`);
  }

  // PHASE 2a: Fetch purchase orders for selected statuses (quantity cross-reference)
  onProgress?.('Buscando pedidos de compra selecionados…', 0, 1);
  const allOrdensCompra: GCOrdemCompra[] = [];
  for (const sid of situacaoCompraIds) {
    let page = 1;
    while (true) {
      const res = await listOrdensCompra(sid, page);
      allOrdensCompra.push(...res.data);
      if (page >= res.meta.total_paginas) break;
      page++;
      if (!isUsingMock()) await new Promise(r => setTimeout(r, 400));
    }
  }

  // PHASE 2b: Fetch ALL purchase orders (all statuses) to derive supplier info
  onProgress?.('Buscando fornecedores via pedidos de compra…', 0, 1);
  const allStatusCompra = await getStatusCompras();
  const allOrdensForSupplier: GCOrdemCompra[] = [];
  const fetchedSids = new Set(situacaoCompraIds);
  for (const status of allStatusCompra) {
    if (fetchedSids.has(status.id)) continue; // already fetched above
    let page = 1;
    while (true) {
      const res = await listOrdensCompra(status.id, page);
      allOrdensForSupplier.push(...res.data);
      if (page >= res.meta.total_paginas) break;
      page++;
      if (!isUsingMock()) await new Promise(r => setTimeout(r, 400));
    }
  }
  const todasOrdens = [...allOrdensCompra, ...allOrdensForSupplier];

  // Build purchase-orders map from SELECTED statuses only (user controls which count)
  const compraMap = new Map<string, {
    qtd: number;
    ordens: Array<{ id: string; codigo: string; qtd: number; nome_fornecedor: string; situacao: string }>;
  }>();
  const compraMapByProduto = new Map<string, {
    qtd: number;
    ordens: Array<{ id: string; codigo: string; qtd: number; nome_fornecedor: string; situacao: string }>;
  }>();
  for (const ordem of allOrdensCompra) {
    for (const p of ordem.produtos || []) {
      const produtoId = normalizeId(p.produto.produto_id);
      if (!produtoId) continue;
      const key = makeProdutoKey(produtoId, p.produto.variacao_id);
      const qty = parseDecimal(p.produto.quantidade);

      if (!compraMap.has(key)) compraMap.set(key, { qtd: 0, ordens: [] });
      const entry = compraMap.get(key)!;
      entry.qtd += qty;
      entry.ordens.push({
        id: ordem.id, codigo: ordem.codigo, qtd: qty,
        nome_fornecedor: ordem.nome_fornecedor, situacao: ordem.nome_situacao,
      });

      if (!compraMapByProduto.has(produtoId)) compraMapByProduto.set(produtoId, { qtd: 0, ordens: [] });
      const byProdutoEntry = compraMapByProduto.get(produtoId)!;
      byProdutoEntry.qtd += qty;
      byProdutoEntry.ordens.push({
        id: ordem.id, codigo: ordem.codigo, qtd: qty,
        nome_fornecedor: ordem.nome_fornecedor, situacao: ordem.nome_situacao,
      });
    }
  }

  // Build supplier map from ALL purchase orders (all statuses/all time)
  const fornecedorPorProduto = new Map<string, { fornecedor_id: string; nome_fornecedor: string }>();
  for (const ordem of todasOrdens) {
    for (const p of ordem.produtos || []) {
      const pid = normalizeId(p.produto.produto_id);
      if (!pid) continue;
      if (!fornecedorPorProduto.has(pid)) {
        fornecedorPorProduto.set(pid, {
          fornecedor_id: ordem.fornecedor_id,
          nome_fornecedor: ordem.nome_fornecedor,
        });
      }
    }
  }

  // PHASE 3: Aggregate budget quantities per product (excluding converted budgets)
  const productMap = new Map<string, {
    produto_id: string; variacao_id: string; nome_produto: string;
    codigo_produto: string; sigla_unidade: string; movimenta_estoque: string;
    qtd_total: number;
    orcamentos: Array<{ id: string; codigo: string; qtd: number; nome_cliente: string }>;
  }>();

  for (const orc of orcamentosElegiveis) {
    for (const p of orc.produtos || []) {
      const produtoId = normalizeId(p.produto.produto_id);
      if (!produtoId) continue;
      const variacaoId = normalizeId(p.produto.variacao_id);
      const key = makeProdutoKey(produtoId, variacaoId);
      const qty = parseDecimal(p.produto.quantidade);
      if (!productMap.has(key)) {
        productMap.set(key, {
          produto_id: produtoId, variacao_id: variacaoId,
          nome_produto: p.produto.nome_produto, codigo_produto: p.produto.codigo_produto,
          sigla_unidade: p.produto.sigla_unidade, movimenta_estoque: p.produto.movimenta_estoque ?? '1',
          qtd_total: 0, orcamentos: [],
        });
      }
      const entry = productMap.get(key)!;
      entry.qtd_total += qty;
      entry.orcamentos.push({ id: orc.id, codigo: orc.codigo, qtd: qty, nome_cliente: orc.nome_cliente });
    }
  }

  // PHASE 4: Fetch stock + cost (supplier derived from purchase orders above)
  const uniqueKeys = [...productMap.keys()];
  const total = uniqueKeys.length;
  const detailCache = new Map<string, GCProdutoDetalhe | null>();

  for (let i = 0; i < uniqueKeys.length; i += 2) {
    const batch = uniqueKeys.slice(i, i + 2);
    onProgress?.('Verificando estoque e preços…', i, total);
    await Promise.all(batch.map(async key => {
      const entry = productMap.get(key)!;
      if (!detailCache.has(entry.produto_id)) {
        const detail = await getProdutoDetalhe(entry.produto_id);
        detailCache.set(entry.produto_id, detail);
      }
    }));
    if (i + 2 < uniqueKeys.length && !isUsingMock()) await new Promise(r => setTimeout(r, 500));
  }
  onProgress?.('Cruzando pedidos de compra…', total, total);

  // DEBUG: Log maps for troubleshooting
  console.log('[COMPRAS DEBUG] compraMap keys:', [...compraMap.keys()]);
  console.log('[COMPRAS DEBUG] compraMapByProduto keys:', [...compraMapByProduto.keys()]);
  console.log('[COMPRAS DEBUG] productMap keys:', [...productMap.keys()]);
  console.log('[COMPRAS DEBUG] allOrdensCompra count:', allOrdensCompra.length);
  console.log('[COMPRAS DEBUG] todasOrdens count:', todasOrdens.length);

  // PHASE 5: Build ItemCompra list with cross-reference
  const allItems: ItemCompra[] = [];

  for (const [key, entry] of productMap) {
    const detail = detailCache.get(entry.produto_id);
    let estoqueAtual = 0;
    let valorCusto = 0;
    let movimentaEstoque = entry.movimenta_estoque === '1';

    if (detail) {
      movimentaEstoque = detail.movimenta_estoque === '1';
      if (entry.variacao_id && detail.variacoes?.length) {
        const v = detail.variacoes.find(v => String(v.variacao.id) === String(entry.variacao_id));
        estoqueAtual = v
          ? parseDecimal(v.variacao.estoque)
          : parseDecimal(detail.estoque);
      } else {
        estoqueAtual = parseDecimal(detail.estoque);
      }
      valorCusto = parseDecimal(detail.valor_custo);
    }

    // Lookup — try exact key first, fall back to produto_id only
    const fullKey = makeProdutoKey(entry.produto_id, entry.variacao_id);
    const pidOnly = String(entry.produto_id).trim();

    const compraEntry =
      compraMap.get(fullKey) ??
      compraMapByProduto.get(pidOnly);

    // De-duplicate ordens_compra (fallback may have dupes)
    const rawOrdens = compraEntry?.ordens ?? [];
    const seenOrdemIds = new Set<string>();
    const ordensCompra = rawOrdens.filter(o => {
      if (seenOrdemIds.has(o.id)) return false;
      seenOrdemIds.add(o.id);
      return true;
    });

    const qtdJaEmCompra = compraEntry?.qtd ?? 0;

    const qtdNecessaria = entry.qtd_total;
    const deficit = Math.max(0, qtdNecessaria - estoqueAtual);
    const qtdEfetivaAComprar = Math.max(0, deficit - qtdJaEmCompra);
    const estimativa = qtdEfetivaAComprar * valorCusto;

    // Supplier derived from purchase orders
    const fornecedorInfo = fornecedorPorProduto.get(entry.produto_id);
    const fornecedorNome = fornecedorInfo?.nome_fornecedor;
    const fornecedorId = fornecedorInfo?.fornecedor_id;

    allItems.push({
      produto_id: entry.produto_id,
      variacao_id: entry.variacao_id,
      nome_produto: detail?.nome || entry.nome_produto,
      codigo_produto: detail?.codigo_interno || entry.codigo_produto,
      sigla_unidade: entry.sigla_unidade,
      grupo: detail?.nome_grupo,
      estoque_atual: estoqueAtual,
      qtd_necessaria: qtdNecessaria,
      qtd_a_comprar: deficit,
      qtd_ja_em_compra: qtdJaEmCompra,
      qtd_efetiva_a_comprar: qtdEfetivaAComprar,
      ultimo_preco: valorCusto,
      estimativa,
      movimenta_estoque: movimentaEstoque,
      fornecedor_id: fornecedorId,
      fornecedor_nome: fornecedorNome,
      fornecedor_telefone: undefined,
      orcamentos: entry.orcamentos,
      ordens_compra: ordensCompra,
    });
  }

  const itensList = allItems.filter(i => i.qtd_efetiva_a_comprar > 0);
  const itensCobertos = allItems.filter(i => i.qtd_efetiva_a_comprar === 0 && i.qtd_a_comprar > 0);
  const itensOkList = allItems.filter(i => i.qtd_a_comprar === 0);
  const estimativaTotal = itensList.reduce((sum, i) => sum + i.estimativa, 0);

  return {
    itensList,
    itensOkList,
    itensCobertosporPedido: itensCobertos,
    orcamentosConvertidos,
    totalOrcamentos: orcamentosElegiveis.length,
    totalProdutosSemEstoque: itensList.length,
    totalProdutosOk: itensOkList.length,
    totalItensCobertosporPedido: itensCobertos.length,
    estimativaTotal,
    scannedAt: new Date().toISOString(),
  };
}
