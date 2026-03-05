import { GCOrdemServico, GCVenda, GCSituacao, GCMeta, GCProdutoItem } from './types';
import { MOCK_OS, MOCK_VENDAS, MOCK_STATUS_OS, MOCK_STATUS_VENDA } from './mockData';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export function isUsingMock(): boolean {
  return !SUPABASE_PROJECT_ID;
}

async function apiRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const method = options?.method || 'GET';
  
  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: {
      path,
      method,
      payload: options?.body ? JSON.parse(options.body) : undefined,
    },
  });

  if (error) {
    throw new Error(error.message || 'Erro de conexão com o servidor');
  }

  // Check GC API status embedded in response
  const gcStatus = (data as any)?.gc_status;
  if (gcStatus && gcStatus !== 200) {
    const gcMsg = (data as any)?.data?.mensagem || (data as any)?.error || '';
    if (gcStatus === 429) throw new Error('RATE_LIMIT');
    if (gcStatus === 401 || gcStatus === 403) throw new Error('AUTH_ERROR');
    throw new Error(gcMsg || `Erro ${gcStatus} no GestãoClick`);
  }

  return data as T;
}

const mockDelay = () => new Promise(r => setTimeout(r, 300));

// --- LIST ---
export async function listOS(situacaoId?: string, pagina = 1): Promise<{ data: GCOrdemServico[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_OS];
    if (situacaoId) data = data.filter(o => o.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/ordens_servicos?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  return apiRequest<{ data: GCOrdemServico[]; meta: GCMeta }>(path);
}

export async function listVendas(situacaoId?: string, pagina = 1): Promise<{ data: GCVenda[]; meta: GCMeta }> {
  if (isUsingMock()) {
    await mockDelay();
    let data = [...MOCK_VENDAS];
    if (situacaoId) data = data.filter(v => v.situacao_id === situacaoId);
    return { data, meta: { pagina_atual: 1, total_paginas: 1, total_registros: data.length } };
  }
  let path = `/api/vendas?pagina=${pagina}`;
  if (situacaoId) path += `&situacao_id=${situacaoId}`;
  return apiRequest<{ data: GCVenda[]; meta: GCMeta }>(path);
}

// --- GET SINGLE ---
export async function getOS(id: string): Promise<GCOrdemServico> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_OS.find(o => o.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCOrdemServico }>(`/api/ordens_servicos/${id}`);
  return res.data;
}

export async function getVenda(id: string): Promise<GCVenda> {
  if (isUsingMock()) {
    await mockDelay();
    const found = MOCK_VENDAS.find(v => v.id === id);
    if (!found) throw new Error('NOT_FOUND');
    return { ...found };
  }
  const res = await apiRequest<{ data: GCVenda }>(`/api/vendas/${id}`);
  return res.data;
}

// --- STATUSES ---
export async function getStatusOS(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_OS];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_ordens_servicos');
  return res.data;
}

export async function getStatusVendas(): Promise<GCSituacao[]> {
  if (isUsingMock()) {
    await mockDelay();
    return [...MOCK_STATUS_VENDA];
  }
  const res = await apiRequest<{ data: GCSituacao[] }>('/api/situacoes_vendas');
  return res.data;
}

// --- UPDATE STATUS ---
export async function updateOSStatus(id: string, rawOrder: GCOrdemServico, newStatusId: string, operatorName?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const obsInterna = rawOrder.observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const payload = {
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data_entrada || rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    observacoes: rawOrder.observacoes || '',
    observacoes_interna: obsInterna + operatorNote,
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
    atributos: rawOrder.atributos || [],
    equipamentos: rawOrder.equipamentos || [],
  };
  await apiRequest(`/api/ordens_servicos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function updateVendaStatus(id: string, rawOrder: GCVenda, newStatusId: string, operatorName?: string): Promise<void> {
  if (isUsingMock()) {
    await mockDelay();
    return;
  }
  const obsInterna = (rawOrder as any).observacoes_interna || '';
  const separator = obsInterna.trim() ? '\n' : '';
  const now = new Date().toLocaleString('pt-BR');
  const operatorNote = operatorName
    ? `${separator}[WeDo Checkout] Separação realizada por: ${operatorName} em ${now}`
    : '';

  const payload = {
    tipo: 'produto',
    cliente_id: rawOrder.cliente_id,
    codigo: rawOrder.codigo,
    data: rawOrder.data,
    situacao_id: newStatusId,
    vendedor_id: rawOrder.vendedor_id,
    observacoes_interna: obsInterna + operatorNote,
    valor_frete: rawOrder.valor_frete || '0.00',
    condicao_pagamento: rawOrder.condicao_pagamento || 'a_vista',
    produtos: rawOrder.produtos,
    servicos: rawOrder.servicos || [],
  };
  await apiRequest(`/api/vendas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// --- PRODUCT DETAILS (for barcode enrichment) ---
interface GCProductDetail {
  id: string;
  codigo_barra: string;
  codigo_interno: string;
  nome: string;
  variacoes?: Array<{ variacao: { id: string; codigo: string } }>;
}

async function getProductDetail(produtoId: string): Promise<GCProductDetail | null> {
  try {
    const res = await apiRequest<{ data: GCProductDetail }>(`/api/produtos/${produtoId}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function enrichOrderProducts(
  produtos: Array<{ produto: GCProdutoItem }>
): Promise<Array<{ produto: GCProdutoItem }>> {
  if (isUsingMock() || !produtos?.length) return produtos;

  // Deduplicate produto_ids
  const uniqueIds = [...new Set(produtos.map(p => p.produto.produto_id))];
  
  // Fetch all product details in parallel
  const details = await Promise.all(uniqueIds.map(id => getProductDetail(id)));
  const detailMap = new Map<string, GCProductDetail>();
  details.forEach(d => { if (d) detailMap.set(d.id, d); });

  return produtos.map(({ produto }) => {
    const detail = detailMap.get(produto.produto_id);
    if (!detail) return { produto };

    // Find variation code if applicable
    let codigoBarras = detail.codigo_barra || '';
    const codigoProduto = detail.codigo_interno || '';

    if (produto.variacao_id && detail.variacoes) {
      const variacao = detail.variacoes.find(v => v.variacao.id === produto.variacao_id);
      if (variacao?.variacao.codigo) {
        // Use variation code as product code if available
        if (!codigoBarras) codigoBarras = '';
      }
    }

    return {
      produto: {
        ...produto,
        codigo_produto: codigoProduto,
        codigo_barras: codigoBarras,
      },
    };
  });
}
