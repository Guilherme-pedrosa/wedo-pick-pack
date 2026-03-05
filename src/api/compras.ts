import {
  GCSituacao, GCMeta, GCOrcamento, GCProdutoDetalhe, GCFornecedor,
  ItemCompra, ComprasResult,
} from './types';
import {
  MOCK_STATUS_ORCAMENTO, MOCK_ORCAMENTOS, MOCK_PRODUTOS_DETALHE, MOCK_FORNECEDORES,
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

// --- STATUS ORCAMENTOS ---
export async function getStatusOrcamentos(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_ORCAMENTO];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_orcamentos');
  return res.data;
}

// --- LIST ORCAMENTOS ---
export async function listOrcamentos(situacaoId?: string, pagina = 1): Promise<{ data: GCOrcamento[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_ORCAMENTOS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/orcamentos?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  return apiRequest<{ data: GCOrcamento[]; meta: GCMeta }>(path);
}

// --- PRODUTO DETALHE ---
export async function getProdutoDetalhe(produtoId: string): Promise<GCProdutoDetalhe | null> {
  if (isUsingMock()) {
    await mockDelay();
    return MOCK_PRODUTOS_DETALHE[produtoId] ?? null;
  }
  try {
    const res = await apiRequest<{ data: GCProdutoDetalhe }>(`/api/produtos/${produtoId}`);
    return res.data;
  } catch {
    return null;
  }
}

// --- FORNECEDOR ---
export async function getFornecedor(fornecedorId: string): Promise<GCFornecedor | null> {
  if (isUsingMock()) {
    await mockDelay();
    return MOCK_FORNECEDORES[fornecedorId] ?? null;
  }
  try {
    const res = await apiRequest<{ data: GCFornecedor }>(`/api/fornecedores/${fornecedorId}`);
    return res.data;
  } catch {
    return null;
  }
}

// --- MAIN ENGINE ---
export async function buildListaCompras(
  situacaoIds: string[],
  onProgress?: (step: string, checked: number, total: number) => void,
): Promise<ComprasResult> {
  // 1. Fetch all pages for each selected situacao
  const allOrcamentos: GCOrcamento[] = [];
  for (const sid of situacaoIds) {
    let page = 1;
    while (true) {
      onProgress?.('Carregando orçamentos…', allOrcamentos.length, 0);
      const res = await listOrcamentos(sid, page);
      allOrcamentos.push(...res.data);
      if (page >= res.meta.total_paginas) break;
      page++;
      if (!isUsingMock()) await new Promise(r => setTimeout(r, 400));
    }
  }

  // 2. Aggregate products across all orcamentos
  const productMap = new Map<string, {
    produto_id: string;
    variacao_id: string;
    nome_produto: string;
    codigo_produto: string;
    sigla_unidade: string;
    movimenta_estoque: string;
    qtd_total: number;
    orcamentos: Array<{ id: string; codigo: string; qtd: number; nome_cliente: string }>;
  }>();

  for (const orc of allOrcamentos) {
    for (const p of orc.produtos || []) {
      const key = `${p.produto.produto_id}::${p.produto.variacao_id}`;
      const qty = typeof p.produto.quantidade === 'number'
        ? p.produto.quantidade
        : parseFloat(String(p.produto.quantidade)) || 0;
      if (!productMap.has(key)) {
        productMap.set(key, {
          produto_id: p.produto.produto_id,
          variacao_id: p.produto.variacao_id,
          nome_produto: p.produto.nome_produto,
          codigo_produto: p.produto.codigo_produto,
          sigla_unidade: p.produto.sigla_unidade,
          movimenta_estoque: p.produto.movimenta_estoque ?? '1',
          qtd_total: 0,
          orcamentos: [],
        });
      }
      const entry = productMap.get(key)!;
      entry.qtd_total += qty;
      entry.orcamentos.push({ id: orc.id, codigo: orc.codigo, qtd: qty, nome_cliente: orc.nome_cliente });
    }
  }

  // 3. Fetch stock + cost + suppliers (rate limited: 2 per batch, 500ms delay)
  const uniqueKeys = [...productMap.keys()];
  const total = uniqueKeys.length;
  const detailCache = new Map<string, GCProdutoDetalhe | null>();
  const fornecedorCache = new Map<string, GCFornecedor | null>();

  for (let i = 0; i < uniqueKeys.length; i += 2) {
    const batch = uniqueKeys.slice(i, i + 2);
    onProgress?.('Verificando estoque e preços…', i, total);
    await Promise.all(batch.map(async key => {
      const entry = productMap.get(key)!;
      if (!detailCache.has(entry.produto_id)) {
        const detail = await getProdutoDetalhe(entry.produto_id);
        detailCache.set(entry.produto_id, detail);
        if (detail?.fornecedores?.length) {
          const fid = String(detail.fornecedores[0].id);
          if (!fornecedorCache.has(fid)) {
            const forn = await getFornecedor(fid);
            fornecedorCache.set(fid, forn);
          }
        }
      }
    }));
    if (i + 2 < uniqueKeys.length && !isUsingMock()) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  onProgress?.('Montando lista…', total, total);

  // 4. Build ItemCompra list
  const allItems: ItemCompra[] = [];
  for (const [, entry] of productMap) {
    const detail = detailCache.get(entry.produto_id);
    let estoqueAtual = 0;
    let valorCusto = 0;
    let movimentaEstoque = entry.movimenta_estoque === '1';

    if (detail) {
      movimentaEstoque = detail.movimenta_estoque === '1';
      if (entry.variacao_id && detail.variacoes?.length) {
        const variacao = detail.variacoes.find(v => String(v.variacao.id) === String(entry.variacao_id));
        estoqueAtual = variacao
          ? (typeof variacao.variacao.estoque === 'number' ? variacao.variacao.estoque : parseFloat(String(variacao.variacao.estoque)) || 0)
          : (typeof detail.estoque === 'number' ? detail.estoque : parseFloat(String(detail.estoque)) || 0);
      } else {
        estoqueAtual = typeof detail.estoque === 'number' ? detail.estoque : parseFloat(String(detail.estoque)) || 0;
      }
      valorCusto = parseFloat(detail.valor_custo || '0') || 0;
    }

    const qtdNecessaria = entry.qtd_total;
    const qtdAComprar = Math.max(0, qtdNecessaria - estoqueAtual);
    const estimativa = qtdAComprar * valorCusto;

    let fornecedorNome: string | undefined;
    let fornecedorTelefone: string | undefined;
    let fornecedorId: string | undefined;
    if (detail?.fornecedores?.length) {
      const fid = String(detail.fornecedores[0].id);
      fornecedorId = fid;
      const forn = fornecedorCache.get(fid);
      fornecedorNome = forn?.nome;
      fornecedorTelefone = forn?.telefone;
    }

    allItems.push({
      produto_id: entry.produto_id,
      variacao_id: entry.variacao_id,
      nome_produto: entry.nome_produto,
      codigo_produto: entry.codigo_produto,
      sigla_unidade: entry.sigla_unidade,
      estoque_atual: estoqueAtual,
      qtd_necessaria: qtdNecessaria,
      qtd_a_comprar: qtdAComprar,
      ultimo_preco: valorCusto,
      estimativa,
      movimenta_estoque: movimentaEstoque,
      fornecedor_id: fornecedorId,
      fornecedor_nome: fornecedorNome,
      fornecedor_telefone: fornecedorTelefone,
      orcamentos: entry.orcamentos,
    });
  }

  const itensList = allItems.filter(i => i.qtd_a_comprar > 0);
  const itensOkList = allItems.filter(i => i.qtd_a_comprar === 0);
  const estimativaTotal = itensList.reduce((sum, i) => sum + i.estimativa, 0);

  return {
    itensList,
    itensOkList,
    totalOrcamentos: allOrcamentos.length,
    totalProdutosSemEstoque: itensList.length,
    totalProdutosOk: itensOkList.length,
    estimativaTotal,
    scannedAt: new Date().toISOString(),
  };
}
